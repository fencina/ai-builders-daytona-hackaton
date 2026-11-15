import type { Metadata,Viewport } from 'next';
import './globals.css';

export const metadata:Metadata={title:'Turno · Tu equipo, a tiempo',description:'Calendario y cobertura de turnos para tiendas de conveniencia.'};
export const viewport:Viewport={width:'device-width',initialScale:1,themeColor:'#111b2b'};
export default function Layout({children}:{children:React.ReactNode}) {
  return <html lang="es"><body>{children}</body></html>;
}
