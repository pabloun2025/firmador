import { useEffect, useRef, useState } from 'react';
import { getSupabase } from '../lib/supabase';
import { newGame, stepGame, type GameState } from '../../supabase/functions/_shared/queue-game';
import './queue-arcade.css';
type RecordRow = { id: string; alias: string; score: number };
type Ticket = { id: string; seed: number };
type Result = { ticket: Ticket | null; ticks: number; jumps: number[]; score: number };
async function callArcade(body: Record<string, unknown>) {
  const client = await getSupabase();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  let response;
  try { response = await client.functions.invoke('queue-arcade', { body, signal: controller.signal }); }
  finally { clearTimeout(timer); }
  const { data, error } = response;
  if (error || data?.error || !Array.isArray(data?.records) || data.records.length > 3 || data.records.some((row: RecordRow) => typeof row.alias !== 'string' || typeof row.id !== 'string' || !Number.isInteger(row.score) || row.score < 1)) throw new Error('El ranking no está disponible. La cola sigue funcionando.');
  if (body.action === 'start' && (typeof data.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(data.id) || !Number.isInteger(data.seed))) throw new Error('Partida no disponible.');
  return data;
}
export function QueueArcade() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const jumpRef = useRef(false);
  const busyRef = useRef(false);
  const mounted = useRef(true);
  const [run, setRun] = useState<Ticket | null>(null);
  const [playing, setPlaying] = useState(false);
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);
  const [score, setScore] = useState(0);
  const [result, setResult] = useState<Result | null>(null);
  const [records, setRecords] = useState<RecordRow[]>([]);
  const [rankingState, setRankingState] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const [busy, setBusy] = useState(false);
  const [alias, setAlias] = useState('');
  const [consent, setConsent] = useState(false);
  const [message, setMessage] = useState('');
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    mounted.current = true;
    void callArcade({ action: 'list' }).then(data => {
      if (mounted.current) { setRecords(data.records); setRankingState('ready'); }
    }).catch(() => { if (mounted.current) setRankingState('unavailable'); });
    return () => { mounted.current = false; };
  }, []);
  const start = async () => {
    if (busyRef.current || playing) return;
    busyRef.current = true; setBusy(true); setMessage('');
    let ticket: Ticket | null = null;
    try {
      const data = await callArcade({ action: 'start' });
      ticket = { id: data.id, seed: data.seed };
      if (mounted.current) { setRecords(data.records); setRankingState('ready'); }
    } catch { if (mounted.current) setMessage('Modo práctica: esta partida no podrá entrar en el ranking.'); }
    finally { busyRef.current = false; if (mounted.current) setBusy(false); }
    if (!mounted.current) return;
    setRun(ticket); setScore(0); setResult(null); setSaved(false); setConsent(false);
    setPaused(false); pausedRef.current = false; jumpRef.current = false;
    setPlaying(true); canvasRef.current?.focus();
  };
  const save = async () => {
    if (!result?.ticket || !consent || busyRef.current || saved) return;
    busyRef.current = true; setBusy(true); setMessage('');
    try {
      const data = await callArcade({ action: 'finish', id: result.ticket.id, ticks: result.ticks, jumps: result.jumps, alias, consent });
      if (mounted.current) { setRecords(data.records); setRankingState('ready'); setSaved(true); setMessage(data.ranked ? '¡Tu resultado está en el top 3!' : 'Partida validada. Aún no alcanza el top 3.'); }
    } catch { if (mounted.current) setMessage('No se pudo guardar. Comprueba tu alias e inténtalo de nuevo; la partida caduca a los 10 minutos.'); }
    finally { busyRef.current = false; if (mounted.current) setBusy(false); }
  };
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const frog = new Image(); frog.src = '/frog-signing.webp';
    const game = newGame(run?.seed ?? 42);
    const jumps: number[] = [];
    let raf = 0, previous = 0, accumulator = 0;
    const draw = (state: GameState) => {
      ctx.clearRect(0, 0, 420, 180);
      ctx.fillStyle = '#e8eedf'; ctx.fillRect(0, 0, 420, 180);
      ctx.fillStyle = '#d8e3cd';
      for (let i = 0; i < 8; i++) { ctx.beginPath(); ctx.arc((i * 70 - state.tick * .22 + 5000) % 490 - 20, 154, 40 + i % 3 * 6, Math.PI, 0); ctx.fill(); }
      ctx.strokeStyle = '#92ab8b'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, 145); ctx.lineTo(420, 145); ctx.stroke();
      const paper = (x: number, signed: boolean) => {
        ctx.fillStyle = '#fffef8'; ctx.strokeStyle = '#799477';
        ctx.beginPath(); ctx.roundRect(x, 110, 26, 35, 2); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#355341'; ctx.font = 'bold 8px sans-serif'; ctx.fillText('PDF', x + 4, 121);
        ctx.fillStyle = '#c4d0bc'; ctx.fillRect(x + 4, 125, 18, 2);
        if (signed) { ctx.strokeStyle = '#16583d'; ctx.beginPath(); ctx.moveTo(x + 4, 139); ctx.lineTo(x + 11, 132); ctx.lineTo(x + 9, 139); ctx.lineTo(x + 21, 135); ctx.stroke(); }
      };
      paper(state.x, false);
      if (!playing) { paper(245, false); paper(335, true); }
      if (state.x < 24) paper(state.x, true);
      if (frog.complete && frog.naturalWidth) ctx.drawImage(frog, 5, 83 - state.y, 74, 50);
      else { ctx.fillStyle = '#16583d'; ctx.beginPath(); ctx.ellipse(40, 121 - state.y, 18, 12, 0, 0, Math.PI * 2); ctx.fill(); }
      if (playing && state.x < 24 && state.x > -26) { ctx.fillStyle = '#245c40'; ctx.font = 'bold 12px sans-serif'; ctx.fillText('+1', 40, 68); }
      if (!playing) { ctx.fillStyle = '#34563d'; ctx.font = '12px sans-serif'; ctx.fillText('Un salto. Un PDF más.', 135, 45); }
    };
    const finish = () => {
      setPlaying(false); setResult({ ticket: run, ticks: game.tick, jumps: [...jumps], score: game.score });
    };
    const frame = (time: number) => {
      if (document.hidden || pausedRef.current) { previous = time; accumulator = 0; raf = requestAnimationFrame(frame); return; }
      if (!previous) previous = time;
      accumulator += Math.min(time - previous, 80); previous = time;
      while (accumulator >= 1000 / 60 && !game.over) {
        const jump = jumpRef.current && game.y === 0;
        jumpRef.current = false;
        if (jump) jumps.push(game.tick + 1);
        stepGame(game, jump); accumulator -= 1000 / 60;
      }
      draw(game); setScore(current => current === game.score ? current : game.score);
      if (game.over) finish(); else raf = requestAnimationFrame(frame);
    };
    const key = (event: KeyboardEvent) => {
      if (['Space', 'ArrowUp'].includes(event.code) && playing) { event.preventDefault(); jumpRef.current = true; }
    };
    canvas.addEventListener('keydown', key);
    draw(game); frog.onload = () => { if (!playing) draw(game); };
    if (playing) raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); canvas.removeEventListener('keydown', key); frog.onload = null; };
  }, [playing, run]);
  const pause = () => { pausedRef.current = !pausedRef.current; setPaused(pausedRef.current); };
  return <section className="queue-game arcade" aria-label="Juego opcional durante la espera">
    <header className="arcade-title"><div><span className="section-kicker">LEAPSIGN · MINIJUEGO</span><h3>Salto de firma</h3></div><span className="arcade-score" aria-label={`${score} puntos`}>{String(score).padStart(2, '0')}<small>PDFs</small></span></header>
    <p className="arcade-subtitle">Salta los documentos. Deja tu firma.</p>
    <div className="arcade-stage"><canvas ref={canvasRef} width={420} height={180} tabIndex={playing ? 0 : -1} onPointerDown={() => { if (playing && !paused) jumpRef.current = true; }} aria-label="Minijuego de una rana saltando documentos PDF" /></div>
    <p className="arcade-help">Toca el juego, pulsa espacio o usa Saltar. La cola sigue su curso.</p>
    <div className="arcade-controls"><button type="button" className="signout" disabled={busy || playing} onClick={start}>{busy && !result ? 'Preparando…' : result ? 'Volver a jugar' : 'Empezar'}</button>{playing && <button type="button" className="signout" onClick={pause}>{paused ? 'Continuar' : 'Pausa'}</button>}<button type="button" className="primary" disabled={!playing || paused} onClick={() => { jumpRef.current = true; }}>Saltar ↑</button></div>
    {result && <p className="arcade-result" role="status">{result.score ? `${result.score} ${result.score === 1 ? 'PDF superado' : 'PDFs superados'}. ¿Otra ronda?` : '¡Casi! Prueba a saltar un poco antes.'}</p>}
    {result?.ticket && result.score > 0 && !saved && <form className="arcade-save" onSubmit={event => { event.preventDefault(); void save(); }}>
      <label>Tu alias en el ranking<input value={alias} onChange={event => setAlias(event.target.value)} minLength={2} maxLength={24} required autoComplete="off" placeholder="Ej. Rana veloz" /></label>
      <label className="arcade-consent"><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} required /><span>Publicar mi alias y puntuación si entro en el top 3. No uses tu correo ni datos personales.</span></label>
      <button className="primary" disabled={!consent || busy}>{busy ? 'Validando…' : 'Guardar mi resultado'}</button>
    </form>}
    {message && <p className="arcade-message" role="status">{message}</p>}
    <section className="arcade-ranking" aria-label="Mejores puntuaciones históricas"><div className="arcade-ranking-heading"><strong>Podio histórico</strong><span>TOP 3 · GLOBAL</span></div>
      {rankingState === 'loading' ? <p>Cargando récords…</p> : rankingState === 'unavailable' ? <p>El ranking no está disponible ahora. Puedes jugar igualmente.</p> : <ol>{[0, 1, 2].map(index => <li key={index}><span className={`podium-rank rank-${index + 1}`}>{index + 1}</span><strong>{records[index]?.alias ?? 'Plaza libre'}</strong><span>{records[index] ? `${records[index].score} PDFs` : '—'}</span></li>)}</ol>}
      <small>Se conservan los tres mejores resultados, aunque se cierre este documento. En caso de empate, queda primero el más antiguo.</small>
    </section>
  </section>;
}
