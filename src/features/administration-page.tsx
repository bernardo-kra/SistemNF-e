"use client";
import { useEffect, useRef, useState } from "react";
import { Field, Modal, PageHeader } from "@/components/ui";
import { accessRequest, AccessError, accessDate } from "@/lib/access-api";
import { useWorkspace } from "./workspace-session";
import styles from "./access-control.module.css";
type Company = {id:string;name:string;status:"active"|"pending"|"inactive";owner:{id?:string;name:string;email:string};requestId?:string;createdAt:string|null};
type Listing={items:Company[];total:number;limit:number;offset:number;capacity:{available:number}};
const endpoint="/api/v1/administration/companies";
export function AdministrationPage() {
  const {handleError}=useWorkspace();
  const [data,setData]=useState<Listing|null>(null),[error,setError]=useState(""),[notice,setNotice]=useState(""),[revision,setRevision]=useState(0);
  const [query,setQuery]=useState(""),[search,setSearch]=useState(""),[offset,setOffset]=useState(0),[editing,setEditing]=useState<Company|"new"|null>(null);
  const opener=useRef<HTMLElement|null>(null);
  useEffect(()=>{const timer=setTimeout(()=>setSearch(query),300);return()=>clearTimeout(timer);},[query]);
  useEffect(()=>{
    const controller=new AbortController();setError("");setData(null);
    void accessRequest<Listing>(`${endpoint}?q=${encodeURIComponent(search)}&limit=25&offset=${offset}`,{signal:controller.signal}).then(result=>{if(!controller.signal.aborted)setData(result);}).catch(failure=>{
      if(controller.signal.aborted)return;
      if(failure instanceof AccessError&&[401,403].includes(failure.status))handleError(failure);else setError(failure instanceof Error?failure.message:"Não foi possível consultar as empresas.");
    });return()=>controller.abort();
  },[search,offset,revision,handleError]);
  const close=()=>{setEditing(null);requestAnimationFrame(()=>opener.current?.focus());};
  return <><PageHeader eyebrow="ACESSO RESTRITO" title="Administração do Sistem" description="Cadastre as empresas selecionadas e libere o primeiro gestor de cada uma." action={<button className="button button-primary" disabled={!data?.capacity.available} onClick={event=>{opener.current=event.currentTarget;setEditing("new");}}>Nova empresa</button>} />
    <p className={styles.note}>Você cadastra a empresa e o gestor. Depois, o gestor cadastra os funcionários em <strong>Equipe e acessos</strong>, usando contas individuais.</p>
    {notice&&<p role="status" className={styles.notice}>{notice}</p>}
    {error&&<p role="alert" className={styles.error}>{error} <button className="button button-secondary" onClick={()=>setRevision(n=>n+1)}>Tentar novamente</button></p>}
    {data&&data.capacity.available===0&&<p className={styles.notice}>O cadastro de novas empresas está indisponível no momento. A preparação de uma nova vaga é feita pelo responsável pela instalação.</p>}
    <section className={styles.panel} aria-label="Empresas selecionadas"><div className={styles.filters}><Field label="Buscar empresa"><input maxLength={100} placeholder="Nome da empresa" value={query} onChange={event=>{setQuery(event.target.value);setOffset(0);}} /></Field></div>
      {!data?<p role="status" className={styles.empty}>{error?"Consulta não concluída.":"Carregando empresas…"}</p>:!data.items.length?<p className={styles.empty}>Nenhuma empresa encontrada.</p>:<div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Empresa</th><th>Gestor</th><th>Situação</th><th>Cadastro</th><th>Ações</th></tr></thead><tbody>{data.items.map(company=><tr key={company.id}><td><strong>{company.name}</strong></td><td>{company.owner.name}<small>{company.owner.email}</small></td><td>{company.status==="active"?"Liberada":company.status==="pending"?"Cadastro pendente":"Inativa"}</td><td>{accessDate(company.createdAt)}</td><td>{company.status==="pending"&&company.requestId&&<button onClick={event=>{opener.current=event.currentTarget;setEditing(company);}}>Concluir cadastro</button>}</td></tr>)}</tbody></table></div>}
      {data&&<div className={styles.footer}><span>{data.total} empresas</span><div><button disabled={!offset} onClick={()=>setOffset(Math.max(0,offset-25))}>Anterior</button><button disabled={offset+25>=data.total} onClick={()=>setOffset(offset+25)}>Próxima</button></div></div>}
    </section>{editing&&<CompanyEditor key={editing==="new"?"new":editing.id} initial={editing==="new"?null:editing} onClose={close} onUnauthorized={handleError} onSaved={company=>{close();setNotice(`${company.name}: acesso liberado. O gestor já pode entrar e cadastrar os funcionários em Equipe e acessos.`);setRevision(n=>n+1);}} />}</>;
}
function CompanyEditor({initial,onClose,onSaved,onUnauthorized}:{initial:Company|null;onClose:()=>void;onSaved:(company:Company)=>void;onUnauthorized:(error:unknown)=>void}) {
  const [draft,setDraft]=useState({name:initial?.name??"",ownerName:initial?.owner.name??"",email:initial?.owner.email??"",password:""});
  const [busy,setBusy]=useState(false),[error,setError]=useState("");
  const attempt=useRef<{content:string;id:string}|null>(null),flight=useRef(false),alive=useRef(true);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  const close=()=>{if(!flight.current)onClose();};
  return <Modal title={initial?"Concluir cadastro":"Nova empresa"} description={initial?"Informe a senha inicial novamente para concluir a mesma tentativa. Uma conta já criada mantém sua senha original.":"Defina a conta individual do gestor. Ele poderá cadastrar a equipe da própria empresa."} onClose={close} onCancel={event=>{if(flight.current)event.preventDefault();else close();}}>
    <form onSubmit={async event=>{
      event.preventDefault();if(flight.current)return;flight.current=true;setBusy(true);setError("");
      const content=JSON.stringify({name:draft.name,ownerName:draft.ownerName,email:draft.email});
      if(attempt.current?.content!==content)attempt.current={content,id:initial?.requestId??crypto.randomUUID()};
      try {
        const result=await accessRequest<{company:Company}>(endpoint,{method:"POST",body:{requestId:attempt.current.id,name:draft.name,owner:{name:draft.ownerName,email:draft.email,password:draft.password}}});
        if(alive.current)onSaved(result.company);
      } catch(failure) {if(alive.current){if(failure instanceof AccessError&&[401,403].includes(failure.status))onUnauthorized(failure);else setError(failure instanceof Error?failure.message:"Não foi possível cadastrar a empresa.");}}
      finally{flight.current=false;if(alive.current)setBusy(false);}
    }}><fieldset disabled={busy} className={styles.form} style={{border:0,padding:0}}>{error&&<p role="alert" className={styles.error}>{error}</p>}
      <Field label="Nome da empresa"><input required maxLength={120} readOnly={Boolean(initial)} autoFocus={!initial} value={draft.name} onChange={event=>setDraft(d=>({...d,name:event.target.value}))} /></Field>
      <Field label="Nome do gestor"><input required maxLength={120} readOnly={Boolean(initial)} value={draft.ownerName} onChange={event=>setDraft(d=>({...d,ownerName:event.target.value}))} /></Field>
      <Field label="E-mail do gestor"><input required type="email" autoComplete="off" maxLength={254} readOnly={Boolean(initial)} value={draft.email} onChange={event=>setDraft(d=>({...d,email:event.target.value}))} /></Field>
      <Field label="Senha inicial do gestor"><input required type="password" minLength={12} maxLength={128} autoComplete="new-password" autoFocus={Boolean(initial)} value={draft.password} onChange={event=>setDraft(d=>({...d,password:event.target.value}))} /></Field>
      <small className={styles.note}>Use uma senha com pelo menos 12 caracteres e entregue os dados de acesso ao gestor por um canal privado.</small>
      <div className="form-actions"><button type="button" className="button button-secondary" onClick={close}>Cancelar</button><button type="submit" className="button button-primary">{busy?"Cadastrando…":initial?"Concluir cadastro":"Cadastrar empresa"}</button></div>
    </fieldset></form>
  </Modal>;
}
