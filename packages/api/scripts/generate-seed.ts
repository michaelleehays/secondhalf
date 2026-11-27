// Writes supabase/seed.sql from SAMPLE_STATE. Run: npm run seed:generate -w @second-half/api
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { SAMPLE_STATE } from "@second-half/contracts/fixtures";
import { seedSql } from "../src/seed";

const out = fileURLToPath(new URL("../../../supabase/seed.sql", import.meta.url));
writeFileSync(out, seedSql(SAMPLE_STATE));
console.log(`Wrote ${out}`);
