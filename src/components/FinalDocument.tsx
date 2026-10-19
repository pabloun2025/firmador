import { useEffect, useRef, useState } from 'react';
import { getSupabase } from '../lib/supabase';
import { roundPath } from '../lib/round-link';
import { finalEmailUrl, finalWhatsappUrl } from '../lib/share';
import './final-document.css';
type FinalInfo = { title: string; expiresAt: string };
async function finalApi(endpoint: string, body: Record<string,unknown>) {
  const client = await getSupabase();
  const controller = new AbortController(), timer = setTimeout(()=>controller.abort(),10000);
  try {
    const {data,error} = await client.functions.invoke(endpoint,{body,signal:controller.signal});
    if(error || !data || data.error) throw new Error('No disponible');
    return data;
  } finally { clearTimeout(timer); }
}
const date = (value: string) => new Date(value).toLocaleString('es-ES',{dateStyle:'medium',timeStyle:'short'});
export function FinalShareCard({workflowId}: {workflowId: string}) {
  const [info,setInfo] = useState<(FinalInfo & {url:string})|null>(null);
  const [error,setError] = useState(false), [busy,setBusy] = useState(false), [copyMessage,setCopyMessage] = useState('');
  const [retry,setRetry] = useState(0);
  useEffect(()=>{
    let current=true; setInfo(null);setError(false);setBusy(true);setCopyMessage('');
    void finalApi('owner-final-share',{id:workflowId}).then(data=>{
      if(typeof data.token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(data.token)||typeof data.title!=='string'||!Number.isFinite(Date.parse(data.expiresAt)))throw new Error('Invalid response');
      if(current)setInfo({title:data.title,expiresAt:data.expiresAt,url:`${window.location.origin}${roundPath(workflowId).replace('/r/','/f/')}#${data.token}`});
    }).catch(()=>{if(current)setError(true);}).finally(()=>{if(current)setBusy(false);});
    return ()=>{current=false;};
  },[workflowId,retry]);
  const copy = async()=>{
    if(!info)return;
    try{await navigator.clipboard.writeText(info.url);setCopyMessage('Enlace copiado.');}
    catch{setCopyMessage('No se pudo copiar. Selecciona el enlace y cópialo manualmente.');}
  };
  return <section className="final-share-card" tabIndex={-1} aria-label="Compartir documento finalizado">
    <span className="section-kicker">DOCUMENTO FINALIZADO</span><h4>Comparte la versión final</h4>
    <p>Quien tenga este enlace podrá descargar el PDF. No permite firmar ni administrar el proceso.</p>
    {busy&&<p role="status">Preparando el enlace…</p>}
    {error&&<><p role="alert">No pudimos preparar el enlace. Comprueba que el documento siga disponible.</p><button className="signout" onClick={()=>setRetry(value=>value+1)}>Reintentar enlace</button></>}
    {info&&<><a className="final-share-url" href={info.url} target="_blank" rel="noreferrer">{info.url}</a>
      <div className="final-share-actions"><button className="signout" onClick={copy}>Copiar enlace final</button><a className="whatsapp-button" href={finalWhatsappUrl(info.title,info.url,info.expiresAt)} target="_blank" rel="noreferrer"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M20.5 11.7a8.5 8.5 0 0 1-12.6 7.5L3.5 20.5l1.3-4.2A8.5 8.5 0 1 1 20.5 11.7Z"/><path d="M8 8c0 4 4 8 8 8l1-2-3-1-1 1-3-3 1-1-1-3z"/></svg>WhatsApp</a><a className="signout final-email" href={finalEmailUrl(info.title,info.url,info.expiresAt)}>Compartir por correo</a></div>
      <small>Disponible hasta el {date(info.expiresAt)}. Comparte el enlace solo con las personas que deban recibir el documento.</small>
    </>}
    {copyMessage&&<p role="status">{copyMessage}</p>}
  </section>;
}
export function FinalDocument({id}: {id: string}) {
  const token = window.location.hash.slice(1);
  const [info,setInfo] = useState<FinalInfo|null>(null), [error,setError] = useState(false), [busy,setBusy] = useState(false), [message,setMessage] = useState('');
  const downloading = useRef(false);
  useEffect(()=>{
    let current=true;
    const robots=document.querySelector('meta[name="robots"]'), previous=robots?.getAttribute('content');
    robots?.setAttribute('content','noindex,nofollow');
    if(!id||!/^[A-Za-z0-9_-]{43}$/.test(token)){setError(true);return ()=>{if(previous)robots?.setAttribute('content',previous);};}
    void finalApi('download-final-share',{id,token,action:'view'}).then(data=>{
      if(typeof data.title!=='string'||!Number.isFinite(Date.parse(data.expiresAt)))throw new Error('Invalid response');
      if(current)setInfo(data);
    }).catch(()=>{if(current)setError(true);});
    return ()=>{current=false;if(previous)robots?.setAttribute('content',previous);};
  },[id,token]);
  const download=async()=>{
    if(downloading.current)return;
    downloading.current=true;setBusy(true);setMessage('');
    try{
      const data=await finalApi('download-final-share',{id,token,action:'download'});
      if(typeof data.url!=='string'||new URL(data.url).protocol!=='https:')throw new Error('Invalid download');
      const link=document.createElement('a');link.href=data.url;link.rel='noreferrer';link.click();
      setMessage('Descarga preparada. Guarda tu copia antes de que caduque el enlace.');
    }catch{setMessage('No pudimos descargar el PDF. El enlace puede haber caducado o el documento ya no estar disponible.');}
    finally{downloading.current=false;setBusy(false);}
  };
  return <section className="round-card final-document-page">
    <span className="section-kicker">PDF FINALIZADO · SOLO DESCARGA</span>
    {error?<><h1>Este enlace ya no está disponible</h1><p>Puede haber caducado o el creador puede haber eliminado el documento. Pídele una copia.</p></>:info?<><h1>{info.title}</h1><p>Esta es la versión final del documento. No necesitas una cuenta ni tomar turno para descargarla.</p><button className="primary wide" onClick={download} disabled={busy}>{busy?'Preparando descarga…':'Descargar PDF final'}</button><p role="status">{message}</p><small>Disponible hasta el {date(info.expiresAt)}.</small></>:<p role="status">Comprobando el documento final…</p>}
  </section>;
}
