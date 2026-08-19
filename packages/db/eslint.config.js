import { baseConfig } from "@ori/config/eslint";

export default [...baseConfig, { ignores: ["src/supabase-types.ts"] }];
