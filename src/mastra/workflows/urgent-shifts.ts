import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import { agent } from '../agents/agent';
import { db, findUrgentShifts, getEmployees, getConversation } from '../lib/database';

const scanSchema = z.object({
  date: z.string(), timezone: z.string(),
  shifts: z.array(z.object({ id: z.string(), start_at: z.string(), end_at: z.string() })),
});
const resultSchema = z.object({ urgentShifts: z.number(), employeesContacted: z.number(), errors: z.array(z.string()) });
const scan = createStep({
  id: 'find-urgent-shifts', inputSchema: z.object({}), outputSchema: scanSchema,
  execute: async () => findUrgentShifts(),
});
const contact = createStep({
  id: 'contact-employees', inputSchema: scanSchema, outputSchema: resultSchema,
  execute: async ({ inputData }) => {
    let employeesContacted = 0;
    const errors: string[] = [];
    if (!inputData.shifts.length) return { urgentShifts: 0, employeesContacted, errors };
    for (const employee of await getEmployees()) {
      const conversation = await getConversation(employee.id);
      if (conversation?.offer_date === inputData.date && conversation.status !== 'active') continue;
      const sent = await db.execute({ sql: 'SELECT shift_id FROM outreach WHERE employee_id = ?', args: [employee.id] });
      const offered = new Set(sent.rows.map(row => String(row.shift_id)));
      const shifts = inputData.shifts.filter(s => !offered.has(s.id));
      if (!shifts.length) continue;
      try {
        const response = await agent.generate(`OUTREACH MODE. Offer these shifts to this employee. Send one WhatsApp message using the tool and include all offered shift IDs.\n${JSON.stringify({ employee, shifts, timezone: inputData.timezone })}`, {
          memory: { thread: `employee-${employee.id}`, resource: employee.id },
        });
        const recorded = await db.execute({ sql: 'SELECT shift_id FROM outreach WHERE employee_id = ?', args: [employee.id] });
        if (!shifts.every(s => recorded.rows.some(r => r.shift_id === s.id))) {
          const failures = response.toolResults.filter(result => result.payload.isError);
          const details = failures.map(({ payload }) =>
            typeof payload.result === 'string' ? payload.result : JSON.stringify(payload.result),
          ).join('; ');
          throw new Error(details || response.text || 'Agent did not send all shift offers');
        }
        employeesContacted++;
      } catch (error) { errors.push(`${employee.id}: ${String(error)}`); }
    }
    return { urgentShifts: inputData.shifts.length, employeesContacted, errors };
  },
});
export const urgentShiftsWorkflow = createWorkflow({
  id: 'urgent-shifts', inputSchema: z.object({}), outputSchema: resultSchema,
}).then(scan).then(contact).commit();
