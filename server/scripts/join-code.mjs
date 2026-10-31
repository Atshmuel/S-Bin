// Writes a one-time join code for a bench leaf as the firmware's join_code.h:
// the leaf asks a gateway for its mesh keys with it, as a real leaf does with the
// code the add-device page gives its setup. The code goes only to the file;
// nothing secret is printed.
//
//   node scripts/join-code.mjs <organization ID> --out <join_code.h>
import { existsSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import dotenv from "dotenv";
import mongoose from "mongoose";
import "../db/models/models.js";
import { organizationModel } from "../db/models/models.js";
import { createJoinCode } from "../db/service/joinService.js";

dotenv.config({ quiet: true });

const args = process.argv.slice(2);
const outIndex = args.indexOf("--out");
const out = outIndex >= 0 ? args[outIndex + 1] : null;
const [orgId] = args.filter((arg, i) => !arg.startsWith("--") && args[i - 1] !== "--out");

if (!orgId || !out) {
    console.error("Usage: node scripts/join-code.mjs <organization ID> --out <join_code.h>");
    process.exit(1);
}
if (!mongoose.Types.ObjectId.isValid(orgId)) {
    console.error("That is not an organization ID.");
    process.exit(1);
}
if (!existsSync(dirname(out))) {
    console.error(`The folder of ${out} does not exist.`);
    process.exit(1);
}

await mongoose.connect(process.env.DB_URL);
try {
    if (!await organizationModel.exists({ _id: orgId })) {
        console.error("No such organization.");
        process.exit(1);
    }
    const { code, expiresAt } = await createJoinCode(orgId, null);
    writeFileSync(out, [
        `// A one-time join code of the organization ${orgId}, made by server/scripts/join-code.mjs.`,
        `// Valid until ${expiresAt.toISOString()}, for one board. A secret: never commit this file.`,
        "#pragma once",
        "",
        `constexpr char JOIN_CODE[] = "${code}";`,
        "",
    ].join("\n"), { mode: 0o600 });
    console.log(`Wrote a join code (valid until ${expiresAt.toISOString()}) to ${out}.`);
} catch (error) {
    console.error(error?.message ?? error);
    process.exitCode = 1;
} finally {
    await mongoose.disconnect();
}
