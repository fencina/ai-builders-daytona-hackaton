'use client';

import { useState } from 'react';
import { ChevronLeft,ChevronRight,Search,Users,CalendarDays } from 'lucide-react';
import type { snapshot,Shift } from '../../../../packages/db';

type Data=Awaited<ReturnType<typeof snapshot>>;
const pageSize=10;
const normalize=(value:string)=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('es');
const localDate=(value:string)=>{const d=new Date(value);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
const dateLabel=(value:string)=>new Date(value).toLocaleDateString('es-AR',{day:'2-digit',month:'short',year:'numeric'});
const timeLabel=(value:string)=>new Date(value).toLocaleTimeString('es-AR',{hour:'2-digit',minute:'2-digit'});

function coverage(shift:Shift) {
  if(shift.status!=='open')return {key:'closed',label:'Cerrado',className:'inactive'};
  if(shift.assigned>=shift.capacity)return {key:'covered',label:'Cubierto',className:'covered'};
  if(shift.pending>0)return {key:'waiting',label:'Requiere aprobación',className:'waiting'};
  return {key:'vacant',label:'Por cubrir',className:'vacant'};
}

function Pagination({total,page,onPage}:{total:number;page:number;onPage:(page:number)=>void}) {
  const pages=Math.max(1,Math.ceil(total/pageSize));
  return <footer className="table-pagination">
    <span role="status">{total?`${(page-1)*pageSize+1}–${Math.min(page*pageSize,total)} de ${total} resultados`:'0 resultados'}</span>
    <div><button className="icon-button bordered" aria-label="Página anterior" disabled={page===1} onClick={()=>onPage(page-1)}><ChevronLeft size={16}/></button><span>Página {page} de {pages}</span><button className="icon-button bordered" aria-label="Página siguiente" disabled={page===pages} onClick={()=>onPage(page+1)}><ChevronRight size={16}/></button></div>
  </footer>;
}

export function ShiftsTable({data,onSelect,onCreate}:{data:Data;onSelect:(id:string)=>void;onCreate:()=>void}) {
  const [query,setQuery]=useState('');
  const [store,setStore]=useState('');
  const [status,setStatus]=useState('');
  const [from,setFrom]=useState('');
  const [to,setTo]=useState('');
  const [order,setOrder]=useState('asc');
  const [requestedPage,setPage]=useState(1);
  const needle=normalize(query.trim());
  const rows=data.shifts.filter(s=>(!store||s.store_id===store)&&(!status||coverage(s).key===status)&&(!from||localDate(s.starts_at)>=from)&&(!to||localDate(s.starts_at)<=to)&&normalize(`${s.role} ${s.store_name}`).includes(needle)).sort((a,b)=>order==='asc'?a.starts_at.localeCompare(b.starts_at):b.starts_at.localeCompare(a.starts_at));
  const page=Math.min(requestedPage,Math.max(1,Math.ceil(rows.length/pageSize)));
  const filtered=!!(query||store||status||from||to);
  function reset(){setQuery('');setStore('');setStatus('');setFrom('');setTo('');setPage(1);}

  return <section className="panel management-panel" aria-labelledby="shifts-table-title">
    <div className="section-heading"><h2 id="shifts-table-title">Gestión de turnos</h2><span className="tag">{data.shifts.length} TURNOS</span></div>
    <div className="table-toolbar">
      <label className="table-search"><Search size={16}/><input type="search" aria-label="Buscar turnos" placeholder="Buscar función o tienda…" value={query} onChange={e=>{setQuery(e.target.value);setPage(1);}}/></label>
      <label>Tienda<select value={store} onChange={e=>{setStore(e.target.value);setPage(1);}}><option value="">Todas las tiendas</option>{data.stores.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
      <label>Estado del turno<select value={status} onChange={e=>{setStatus(e.target.value);setPage(1);}}><option value="">Todos los estados</option><option value="vacant">Por cubrir</option><option value="waiting">Requiere aprobación</option><option value="covered">Cubierto</option><option value="closed">Cerrado</option></select></label>
      <label>Desde<input type="date" value={from} max={to||undefined} onChange={e=>{setFrom(e.target.value);setPage(1);}}/></label>
      <label>Hasta<input type="date" value={to} min={from||undefined} onChange={e=>{setTo(e.target.value);setPage(1);}}/></label>
      {filtered?<button className="text-button" onClick={reset}>Limpiar filtros</button>:null}
    </div>
    <div className="table-scroll" role="region" aria-label="Tabla de turnos" tabIndex={0}><table className="management-table">
      <caption className="sr-only">Turnos, horarios, cobertura y postulaciones. Ordenados por fecha {order==='asc'?'ascendente':'descendente'}.</caption>
      <thead><tr><th scope="col" aria-sort={order==='asc'?'ascending':'descending'}><button className="table-sort" onClick={()=>{setOrder(order==='asc'?'desc':'asc');setPage(1);}}>Fecha {order==='asc'?'↑':'↓'}</button></th><th scope="col">Horario</th><th scope="col">Función / Tienda</th><th scope="col">Cobertura</th><th scope="col">Postulantes</th><th scope="col">Estado</th><th scope="col">Acciones</th></tr></thead>
      <tbody>{rows.slice((page-1)*pageSize,page*pageSize).map(s=>{const state=coverage(s);return <tr key={s.id}><td>{dateLabel(s.starts_at)}</td><td><span className="table-nowrap">{timeLabel(s.starts_at)}–{timeLabel(s.ends_at)}</span>{localDate(s.starts_at)!==localDate(s.ends_at)?<small>Fin: {dateLabel(s.ends_at)}</small>:null}</td><td><strong>{s.role}</strong><small>{s.store_name}</small></td><td><span className="table-nowrap">{s.assigned} / {s.capacity} personas</span></td><td>{s.pending}</td><td><span className={`status ${state.className}`}>{state.label}</span></td><td><button className="outline" onClick={()=>onSelect(s.id)} aria-label={`Gestionar ${s.role} en ${s.store_name}, ${dateLabel(s.starts_at)} ${timeLabel(s.starts_at)}`}>Gestionar<ChevronRight size={14}/></button></td></tr>;})}</tbody>
    </table></div>
    {!rows.length?<div className="empty"><CalendarDays size={28}/><h3>{data.shifts.length?'No hay turnos con estos filtros.':'Aún no hay turnos.'}</h3><p>{data.shifts.length?'Prueba otra búsqueda o cambia el rango de fechas.':'Crea tu primer turno para organizar la cobertura.'}</p><button className="text-button" onClick={filtered?reset:onCreate}>{filtered?'Limpiar filtros':'Crear turno'}</button></div>:null}
    <Pagination total={rows.length} page={page} onPage={setPage}/>
  </section>;
}

export function EmployeesTable({data,onCreate}:{data:Data;onCreate:()=>void}) {
  const [query,setQuery]=useState('');
  const [store,setStore]=useState('');
  const [status,setStatus]=useState('');
  const [order,setOrder]=useState('asc');
  const [requestedPage,setPage]=useState(1);
  const stores=new Map(data.stores.map(s=>[s.id,s.name]));
  const needle=normalize(query.trim());
  const rows=data.employees.filter(e=>(!store||e.store_ids.includes(store))&&(!status||(status==='active'?!!e.active:!e.active))&&normalize(`${e.name} ${e.phone} ${e.store_ids.map(id=>stores.get(id)||'').join(' ')}`).includes(needle)).sort((a,b)=>order==='asc'?a.name.localeCompare(b.name,'es'):b.name.localeCompare(a.name,'es'));
  const page=Math.min(requestedPage,Math.max(1,Math.ceil(rows.length/pageSize)));
  const filtered=!!(query||store||status);
  function reset(){setQuery('');setStore('');setStatus('');setPage(1);}

  return <section className="panel management-panel" aria-labelledby="employees-table-title">
    <div className="section-heading"><h2 id="employees-table-title">Tu equipo</h2><span className="tag">{data.employees.length} EMPLEADOS</span></div>
    <div className="table-toolbar">
      <label className="table-search"><Search size={16}/><input type="search" aria-label="Buscar empleados" placeholder="Buscar nombre, teléfono o tienda…" value={query} onChange={e=>{setQuery(e.target.value);setPage(1);}}/></label>
      <label>Tienda del empleado<select value={store} onChange={e=>{setStore(e.target.value);setPage(1);}}><option value="">Todas las tiendas</option>{data.stores.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
      <label>Estado del empleado<select value={status} onChange={e=>{setStatus(e.target.value);setPage(1);}}><option value="">Todos los estados</option><option value="active">Activo</option><option value="inactive">Inactivo</option></select></label>
      {filtered?<button className="text-button" onClick={reset}>Limpiar filtros</button>:null}
    </div>
    <div className="table-scroll" role="region" aria-label="Tabla de empleados" tabIndex={0}><table className="management-table">
      <caption className="sr-only">Empleados, contacto, tiendas habilitadas y estado.</caption>
      <thead><tr><th scope="col" aria-sort={order==='asc'?'ascending':'descending'}><button className="table-sort" onClick={()=>{setOrder(order==='asc'?'desc':'asc');setPage(1);}}>Empleado {order==='asc'?'↑':'↓'}</button></th><th scope="col">WhatsApp</th><th scope="col">Tiendas habilitadas</th><th scope="col">Estado</th></tr></thead>
      <tbody>{rows.slice((page-1)*pageSize,page*pageSize).map(e=><tr key={e.id}><th scope="row"><div className="table-person"><span className="avatar" aria-hidden="true">{e.name[0]}</span><strong>{e.name}</strong></div></th><td><a className="table-nowrap" href={`tel:+${e.phone}`}>+{e.phone}</a></td><td>{e.store_ids.map(id=>stores.get(id)).filter(Boolean).join(' · ')||'Sin tiendas habilitadas'}</td><td><span className={`status ${e.active?'covered':'inactive'}`}>{e.active?'Activo':'Inactivo'}</span></td></tr>)}</tbody>
    </table></div>
    {!rows.length?<div className="empty"><Users size={28}/><h3>{data.employees.length?'No hay empleados con estos filtros.':'Todo empieza con las personas.'}</h3><p>{data.employees.length?'Prueba otro nombre, teléfono o tienda.':'Registra empleados y sus tiendas habilitadas con su autorización para recibir invitaciones por WhatsApp.'}</p><button className="text-button" onClick={filtered?reset:onCreate}>{filtered?'Limpiar filtros':'Añadir empleado'}</button></div>:null}
    <Pagination total={rows.length} page={page} onPage={setPage}/>
  </section>;
}
