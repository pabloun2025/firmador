import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { 'jsr:@supabase/supabase-js@2': '@supabase/supabase-js' } },
});
