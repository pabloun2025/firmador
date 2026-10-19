import { expect, it } from 'vitest';
import { finalShareToken, equalFinalToken } from '../supabase/functions/_shared/final-share';
import { finalEmailUrl, finalWhatsappUrl } from '../src/lib/share';
it('binds the capability to the secret, workflow and exact final version', async()=>{
  const token=await finalShareToken('synthetic-only','round-1','version-1');
  expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(await finalShareToken('synthetic-only','round-1','version-1')).toBe(token);
  for(const args of [['other','round-1','version-1'],['synthetic-only','round-2','version-1'],['synthetic-only','round-1','version-2']])expect(await finalShareToken(...args as [string,string,string])).not.toBe(token);
  expect(equalFinalToken(token,token)).toBe(true);
  for(const invalid of [null,'',token+'x',token.slice(1),`${token[0]==='a'?'b':'a'}${token.slice(1)}`])expect(equalFinalToken(invalid,token)).toBe(false);
});
it('shares the final copy rather than sending a new invitation to sign',()=>{
  const link='https://firma.veryfacil.org/f/demo#token';
  const expiry='2026-10-24T10:00:00Z';
  const message=new URL(finalWhatsappUrl('Acuerdo & contrato',link,expiry)).searchParams.get('text')!;
  expect(message).toContain(link);expect(message).toContain('versión final');expect(message).toContain('No es una invitación');expect(message).toContain('24 oct 2026');
  const mail=new URL(finalEmailUrl('Acuerdo & contrato',link,expiry));
  expect(mail.protocol).toBe('mailto:');expect(mail.searchParams.get('body')).toBe(message);
  expect(mail.searchParams.get('subject')).toBe('PDF finalizado · Acuerdo & contrato');
});
