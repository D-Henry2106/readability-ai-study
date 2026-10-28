'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
export function PilotRestartButton() {
  const [busy,setBusy] = useState(false); const [error,setError] = useState(''); const router=useRouter();
  async function run() { if (!window.confirm('Tạo phiên PILOT mới? Kết quả phiên cũ được giữ nguyên.')) return;
    setBusy(true);setError('');try {const r=await fetch('/api/session/restart-pilot',{method:'POST'});const j=await r.json();if(!r.ok) throw new Error(j.error??'Không thể thử lại.');router.push(j.nextRoute??'/information');}catch(e){setError(e instanceof Error?e.message:'Không thể thử lại.');}finally{setBusy(false);}}
  return <div className="stack-sm"><button type="button" className="btn btn-secondary" disabled={busy} onClick={run}>{busy?'Đang tạo phiên thử…':'Tạo phiên PILOT mới'}</button>{error&&<p role="alert">{error}</p>}</div>;
}
