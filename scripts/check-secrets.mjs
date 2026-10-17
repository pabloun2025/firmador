import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const patterns = [
  ['github-token', /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{50,})\b/],
  ['supabase-secret', /\bsb_secret_[A-Za-z0-9_-]{16,}\b/],
  ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['aws-access-key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
  ['openai-secret', /\bsk-(?:proj-)?[A-Za-z0-9_-]{30,}\b/],
  ['resend-key', /\bre_[A-Za-z0-9]{25,}\b/],
];
for (const project of ['firmador']) {
  const cwd=resolve(import.meta.dirname,'..');
  const listed=spawnSync('git',['ls-files','-z'],{cwd,encoding:'utf8'});
  const findings=[]; let checked=0;
  for (const file of listed.stdout.split('\0').filter(Boolean)) {
    let content; try {content=readFileSync(`${cwd}/${file}`,'utf8');}catch {continue;}
    checked++;
    for (const [rule,pattern] of patterns) if(pattern.test(content)) findings.push({file,rule});
    for(const match of content.matchAll(/eyJ[A-Za-z0-9_-]+\.([A-Za-z0-9_-]+)\.[A-Za-z0-9_-]+/g)) {
      try { if(JSON.parse(Buffer.from(match[1],'base64url').toString()).role==='service_role') findings.push({file,rule:'service-role-jwt'}); }catch {}
    }
  }
  const history=spawnSync('git',['log','--all','--format=','-p','--no-ext-diff'],{cwd,encoding:'utf8',maxBuffer:32*1024*1024});
  const historicalRules=patterns.filter(([,pattern])=>pattern.test(history.stdout)).map(([rule])=>rule);
  if (findings.length || historicalRules.length) process.exitCode = 1;
  console.log(JSON.stringify({project,trackedFilesChecked:checked,findings,historyScanCompleted:history.status===0,historicalPatternMatches:historicalRules}));
}
// A clean scan is evidence for these patterns, not proof that no secret exists.
