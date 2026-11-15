-- Single transactional entry point for the Turno application.
-- SECURITY INVOKER + grants only to service_role: the Next.js server (never the
-- browser) reaches it with the secret key. No business data is exposed through
-- the Data API schema.

create or replace function public.turno_execute(p_action text, p_input jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = turno, pg_temp
as $$
declare
  v_id uuid;
  v_shift turno.shifts;
  v_application turno.applications;
  v_invitation turno.invitations;
  v_actor text := coalesce(nullif(trim(p_input->>'actor'), ''), 'Sistema');
  v_assigned int;
  v_pending int;
  v_outstanding int;
  v_count int;
begin
  if p_action = 'snapshot' then
    return jsonb_build_object(
      'stores', coalesce((
        select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'address', s.address) order by s.name)
        from turno.stores s), '[]'::jsonb),
      'employees', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', e.id, 'name', e.name, 'phone', e.phone, 'active', e.active,
          'store_ids', coalesce((
            select jsonb_agg(es.store_id order by es.store_id)
            from turno.employee_stores es where es.employee_id = e.id), '[]'::jsonb)
        ) order by e.name)
        from turno.employees e), '[]'::jsonb),
      'shifts', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', t.id, 'store_id', t.store_id, 'store_name', s.name, 'role', t.role,
          'starts_at', t.starts_at, 'ends_at', t.ends_at, 'capacity', t.capacity, 'status', t.status,
          'assigned', (select count(*) from turno.assignments a where a.shift_id = t.id),
          'pending', (select count(*) from turno.applications a where a.shift_id = t.id and a.status = 'pending')
        ) order by t.starts_at)
        from turno.shifts t join turno.stores s on s.id = t.store_id), '[]'::jsonb),
      'applications', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', a.id, 'shift_id', a.shift_id, 'employee_id', a.employee_id, 'status', a.status,
          'created_at', a.created_at, 'name', e.name, 'phone', e.phone, 'store_name', s.name,
          'role', t.role, 'starts_at', t.starts_at, 'ends_at', t.ends_at
        ) order by a.created_at desc)
        from turno.applications a
        join turno.employees e on e.id = a.employee_id
        join turno.shifts t on t.id = a.shift_id
        join turno.stores s on s.id = t.store_id), '[]'::jsonb),
      'assignments', coalesce((
        select jsonb_agg(jsonb_build_object('id', a.id, 'shift_id', a.shift_id, 'employee_id', a.employee_id, 'name', e.name))
        from turno.assignments a join turno.employees e on e.id = a.employee_id), '[]'::jsonb),
      'events', coalesce((
        select jsonb_agg(jsonb_build_object('id', ev.id, 'message', ev.message, 'created_at', ev.created_at) order by ev.created_at desc)
        from (select * from turno.events order by created_at desc limit 50) ev), '[]'::jsonb),
      'settings', jsonb_build_object(
        'adminPhone', coalesce((select value from turno.settings where key = 'admin_phone'), ''),
        'session', coalesce((select value from turno.settings where key = 'openwa_session'), ''),
        'configured', exists(select 1 from turno.settings where key = 'admin_phone')
          and exists(select 1 from turno.settings where key = 'openwa_session'))
    );
  end if;

  if p_action = 'setting' then
    return to_jsonb(coalesce((select value from turno.settings where key = p_input->>'key'), ''));
  end if;

  if p_action = 'event' then
    insert into turno.events (id, message) values (gen_random_uuid(), p_input->>'message');
    return 'null'::jsonb;
  end if;

  if p_action = 'store' then
    insert into turno.stores (id, name, address) values ((p_input->>'id')::uuid, trim(p_input->>'name'), coalesce(p_input->>'address', ''));
    insert into turno.events (id, message) values (gen_random_uuid(), format('%s creó la tienda %s.', v_actor, trim(p_input->>'name')));
    return jsonb_build_object('id', p_input->>'id');
  end if;

  if p_action = 'employee' then
    insert into turno.employees (id, name, phone, active)
    values ((p_input->>'id')::uuid, trim(p_input->>'name'), regexp_replace(p_input->>'phone', '^\+', ''), true);
    insert into turno.employee_stores (employee_id, store_id)
    select (p_input->>'id')::uuid, value::uuid from jsonb_array_elements_text(p_input->'storeIds')
    on conflict do nothing;
    insert into turno.events (id, message) values (gen_random_uuid(), format('%s registró a %s.', v_actor, trim(p_input->>'name')));
    return jsonb_build_object('id', p_input->>'id');
  end if;

  if p_action = 'shift' then
    insert into turno.shifts (id, store_id, role, starts_at, ends_at, capacity, status)
    values ((p_input->>'id')::uuid, (p_input->>'storeId')::uuid, trim(p_input->>'role'),
            (p_input->>'startsAt')::timestamptz, (p_input->>'endsAt')::timestamptz,
            (p_input->>'capacity')::int, 'open');
    insert into turno.events (id, message) values (gen_random_uuid(), format('%s creó un turno de %s.', v_actor, trim(p_input->>'role')));
    return jsonb_build_object('id', p_input->>'id');
  end if;

  if p_action = 'settings' then
    insert into turno.settings (key, value) values ('admin_phone', regexp_replace(p_input->>'adminPhone', '^\+', ''))
      on conflict (key) do update set value = excluded.value;
    insert into turno.settings (key, value) values ('openwa_session', p_input->>'session')
      on conflict (key) do update set value = excluded.value;
    return 'null'::jsonb;
  end if;

  if p_action = 'outstanding' then
    select count(*) into v_count from turno.invitations
      where shift_id = (p_input->>'shiftId')::uuid and status in ('sent', 'sending', 'uncertain');
    return to_jsonb(v_count);
  end if;

  if p_action = 'candidates' then
    return coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.id, 'name', e.name, 'phone', e.phone, 'active', e.active,
        'store_ids', coalesce((select jsonb_agg(es.store_id) from turno.employee_stores es where es.employee_id = e.id), '[]'::jsonb)
      ) order by e.name)
      from turno.employees e
      join turno.shifts t on t.id = (p_input->>'shiftId')::uuid
      where e.active
        and t.status = 'open' and t.starts_at > now()
        and exists (select 1 from turno.employee_stores es where es.employee_id = e.id and es.store_id = t.store_id)
        and not exists (select 1 from turno.invitations i where i.shift_id = t.id and i.employee_id = e.id and i.status <> 'failed')
        and not exists (
          select 1 from turno.assignments a join turno.shifts o on o.id = a.shift_id
          where a.employee_id = e.id and o.status = 'open' and o.starts_at < t.ends_at and o.ends_at > t.starts_at)
    ), '[]'::jsonb);
  end if;

  if p_action = 'claim' then
    select * into v_shift from turno.shifts where id = (p_input->>'shiftId')::uuid for update;
    if not found or v_shift.status <> 'open' or v_shift.starts_at <= now() then
      return 'null'::jsonb;
    end if;
    select count(*) into v_assigned from turno.assignments where shift_id = v_shift.id;
    select count(*) into v_pending from turno.applications where shift_id = v_shift.id and status = 'pending';
    select count(*) into v_outstanding from turno.invitations where shift_id = v_shift.id and status in ('sent', 'sending', 'uncertain');
    if v_assigned + v_pending + v_outstanding >= v_shift.capacity then
      return 'null'::jsonb;
    end if;
    insert into turno.invitations (id, shift_id, employee_id, status)
    values ((p_input->>'id')::uuid, v_shift.id, (p_input->>'employeeId')::uuid, 'sending')
    on conflict (shift_id, employee_id) do update set status = 'sending', id = excluded.id
      where turno.invitations.status = 'failed';
    if not found then
      return 'null'::jsonb;
    end if;
    return to_jsonb(p_input->>'id');
  end if;

  if p_action = 'invitation_status' then
    update turno.invitations set status = p_input->>'to'
      where id = (p_input->>'invitationId')::uuid and status = p_input->>'from';
    return to_jsonb(found);
  end if;

  if p_action = 'claim_webhook' then
    insert into turno.webhook_events (id) values (p_input->>'key') on conflict (id) do nothing;
    return to_jsonb(found);
  end if;

  if p_action = 'employee_phone' then
    return coalesce((
      select jsonb_build_object('id', e.id) from turno.employees e
      where e.phone = p_input->>'phone' and e.active limit 1), 'null'::jsonb);
  end if;

  if p_action = 'invitation_for' then
    return to_jsonb(exists(
      select 1 from turno.invitations i
      where i.id = (p_input->>'invitationId')::uuid
        and i.employee_id = (p_input->>'employeeId')::uuid
        and i.status = 'sent'));
  end if;

  if p_action = 'apply' then
    select * into v_shift from turno.shifts where id = (
      select shift_id from turno.invitations where id = (p_input->>'invitationId')::uuid) for update;
    select * into v_invitation from turno.invitations where id = (p_input->>'invitationId')::uuid and status = 'sent';
    if not found then raise exception 'La invitación no está pendiente.'; end if;
    if v_shift.id is null or v_shift.status <> 'open' or v_shift.starts_at <= now() then
      raise exception 'El turno no está disponible o ya comenzó.';
    end if;
    if not exists (select 1 from turno.employees e join turno.employee_stores es on es.employee_id = e.id
                   where e.id = v_invitation.employee_id and e.active and es.store_id = v_shift.store_id) then
      raise exception 'El empleado no está habilitado para esta tienda.';
    end if;
    if exists (select 1 from turno.assignments a join turno.shifts o on o.id = a.shift_id
               where a.employee_id = v_invitation.employee_id and o.status = 'open'
                 and o.starts_at < v_shift.ends_at and o.ends_at > v_shift.starts_at) then
      raise exception 'El empleado tiene un turno solapado.';
    end if;
    select count(*) into v_assigned from turno.assignments where shift_id = v_shift.id;
    if v_assigned >= v_shift.capacity then raise exception 'El turno ya está cubierto.'; end if;
    v_id := gen_random_uuid();
    insert into turno.applications (id, shift_id, employee_id, status)
    values (v_id, v_shift.id, v_invitation.employee_id, 'pending');
    update turno.invitations set status = 'accepted' where id = v_invitation.id;
    insert into turno.events (id, message) values (gen_random_uuid(), 'Se recibió una postulación. Pendiente de aprobación del administrador.');
    return to_jsonb(v_id);
  end if;

  if p_action = 'decide' then
    select * into v_application from turno.applications where id = (p_input->>'applicationId')::uuid for update;
    if not found then raise exception 'Postulación no encontrada.'; end if;
    if v_application.status = p_input->>'decision' then
      return jsonb_build_object('ok', true, 'changed', false);
    end if;
    if v_application.status <> 'pending' then raise exception 'Esta postulación ya fue resuelta.'; end if;
    if p_input->>'decision' = 'approved' then
      select * into v_shift from turno.shifts where id = v_application.shift_id for update;
      if v_shift.status <> 'open' or v_shift.starts_at <= now() then
        raise exception 'El turno no está disponible o ya comenzó.';
      end if;
      if not exists (select 1 from turno.employees e join turno.employee_stores es on es.employee_id = e.id
                     where e.id = v_application.employee_id and e.active and es.store_id = v_shift.store_id) then
        raise exception 'El empleado no está habilitado para esta tienda.';
      end if;
      if exists (select 1 from turno.assignments a join turno.shifts o on o.id = a.shift_id
                 where a.employee_id = v_application.employee_id and o.status = 'open'
                   and o.starts_at < v_shift.ends_at and o.ends_at > v_shift.starts_at) then
        raise exception 'El empleado tiene un turno solapado.';
      end if;
      select count(*) into v_assigned from turno.assignments where shift_id = v_shift.id;
      if v_assigned >= v_shift.capacity then raise exception 'El turno ya tiene todas sus plazas cubiertas.'; end if;
      insert into turno.assignments (id, shift_id, employee_id) values (gen_random_uuid(), v_shift.id, v_application.employee_id);
    end if;
    update turno.applications set status = p_input->>'decision' where id = v_application.id;
    insert into turno.events (id, message) values (gen_random_uuid(),
      format('%s: postulación %s (%s).', v_actor,
        case when p_input->>'decision' = 'approved' then 'aprobada' else 'rechazada' end, v_application.id));
    return jsonb_build_object('ok', true, 'changed', true);
  end if;

  raise exception 'Acción no admitida.';
end;
$$;

revoke all on function public.turno_execute(text, jsonb) from public, anon, authenticated;
grant execute on function public.turno_execute(text, jsonb) to service_role;
