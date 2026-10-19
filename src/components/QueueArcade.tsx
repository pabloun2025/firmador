import { useEffect, useRef, useState } from 'react';
import { getSupabase } from '../lib/supabase';
import { qualifiesForPodium } from '../lib/high-score';
import { newGame, stepGame, type GameState } from '../../supabase/functions/_shared/queue-game';
import './queue-arcade.css';
type RecordRow = { id: string; alias: string; score: number };
type Ticket = { id: string; seed: number };
type Result = { ticket: Ticket | null; ticks: number; jumps: number[]; score: number };
function PodiumFrog() {
  return <svg className="podium-frog" viewBox="0 0 64 62" aria-hidden="true">
    <path fill="currentColor" d="M8 33C5 25 7 9 18 9c8 0 10 7 14 7s6-7 14-7c11 0 13 16 10 24l5 12c-8 2-15 0-19-4H22c-4 4-11 6-19 4z" />
    <ellipse cx="19" cy="21" rx="7" ry="8" fill="#fffef8" /><ellipse cx="45" cy="21" rx="7" ry="8" fill="#fffef8" />
    <circle cx="20" cy="22" r="4" fill="#264a39" /><circle cx="44" cy="22" r="4" fill="#264a39" />
    <path d="M16 34q16 9 32 0" stroke="#fffef8" strokeWidth="3" fill="none" strokeLinecap="round" />
    <path d="m25 42 7 5 7-5-3 13h-8z" fill="#426752" /><circle cx="32" cy="53" r="7" fill="currentColor" stroke="#fffef8" strokeWidth="2" />
  </svg>;
}
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
  const [dismissed, setDismissed] = useState(false);
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
    } catch { if (mounted.current) setMessage('No se pudo iniciar el juego. Inténtalo de nuevo.'); return; }
    finally { busyRef.current = false; if (mounted.current) setBusy(false); }
    if (!mounted.current) return;
    setRun(ticket); setScore(0); setResult(null); setSaved(false); setDismissed(false); setAlias('');
    setPaused(false); pausedRef.current = false; jumpRef.current = false;
    setPlaying(true); canvasRef.current?.focus();
  };
  const save = async () => {
    if (!result?.ticket || !qualifiesForPodium(result.score, records) || busyRef.current || saved) return;
    busyRef.current = true; setBusy(true); setMessage('');
    try {
      const data = await callArcade({ action: 'finish', id: result.ticket.id, ticks: result.ticks, jumps: result.jumps, alias, consent: true });
      if (mounted.current) { setRecords(data.records); setRankingState('ready'); setSaved(true); setMessage(data.ranked ? '¡Récord guardado!' : 'Otra persona se ha adelantado. ¡Prueba otra vez!'); }
    } catch { if (mounted.current) setMessage('No se pudo guardar el récord. Revisa el nombre e inténtalo de nuevo.'); }
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
    {result?.ticket && qualifiesForPodium(result.score, records) && !saved && !dismissed && <form className="arcade-save" onSubmit={event => { event.preventDefault(); void save(); }}>
      <strong className="arcade-high-score">HIGH SCORE · {result.score}</strong>
      <label>Tus iniciales o nombre<input value={alias} onChange={event => setAlias(event.target.value)} minLength={2} maxLength={24} required autoComplete="off" autoFocus placeholder="AAA" /></label>
      <small id="high-score-privacy">Al guardar, tu nombre y puntuación serán públicos. Puedes usar un apodo.</small>
      <div className="arcade-save-actions"><button className="primary" aria-describedby="high-score-privacy" disabled={busy}>{busy ? 'Guardando…' : 'Guardar récord'}</button><button type="button" className="text-button" disabled={busy} onClick={() => setDismissed(true)}>Omitir</button></div>
    </form>}
    {message && <p className="arcade-message" role="status">{message}</p>}
    <section className="arcade-ranking" aria-label="Mejores puntuaciones históricas"><div className="arcade-ranking-heading"><strong>Podio histórico</strong><span>TOP 3 · GLOBAL</span></div>
      {rankingState === 'loading' ? <p>Cargando récords…</p> : rankingState === 'unavailable' ? <p>Los récords no están disponibles ahora.</p> : <ol className="arcade-podium">{[0, 1, 2].map(index => <li className={`podium-place place-${index + 1}`} key={index} aria-label={`${index + 1}º: ${records[index]?.alias ?? 'Sin récord'}, ${records[index]?.score ?? 0} puntos`}><PodiumFrog /><strong title={records[index]?.alias}>{records[index]?.alias ?? '—'}</strong><span className="podium-points">{records[index]?.score ?? '—'}</span><span className="podium-step" aria-hidden="true">{index + 1}</span></li>)}</ol>}
    </section>
  </section>;
}
