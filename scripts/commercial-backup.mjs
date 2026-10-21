import { mkdir, open, writeFile, readFile, cp, chmod } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const envPath = process.env.COMMERCIAL_ENV_FILE || path.join(root, "output/commercial-development/commercial.env");
const env = Object.fromEntries((await readFile(envPath, "utf8")).split("\n").filter(l => l && !l.startsWith("#")).map(l => {
  const index = l.indexOf("="); return [l.slice(0, index), l.slice(index + 1)];
}));
const destination = path.resolve(process.argv[2] || path.join(root, "output/backups", new Date().toISOString().replaceAll(":", "-")));
await mkdir(destination, {recursive:true,mode:0o700});
await chmod(destination,0o700);
const dumpFile = path.join(destination,"database.dump");
const file = await open(dumpFile,"wx",0o600);
try {
  await new Promise((resolve,reject) => {
    const child = spawn("docker", ["exec", "mosaic-commercial-postgres", "pg_dump", "-U", "mosaic_owner", "-d", "mosaic_commercial", "-Fc"], {stdio:["ignore",file.fd,"pipe"]});
    let error = "";
    child.stderr.on("data", b => { if(error.length<4000)error+=b; });
    child.on("error",reject);
    child.on("close",code => code === 0 ? resolve() : reject(Error(`Database backup failed (${code}): ${error}`)));
  });
} finally { await file.close(); }
await cp(env.COMMERCIAL_DATA_DIR, path.join(destination,"data"), {recursive:true,errorOnExist:true,force:false});
const hash = createHash("sha256").update(await readFile(dumpFile)).digest("hex");
await writeFile(path.join(destination,"manifest.json"), JSON.stringify({createdAt:new Date().toISOString(),database:"mosaic_commercial",dumpSHA256:hash,dataDirectory:"data",note:"Database and immutable media snapshot. Retain deployment config and signing keys in separate private backup."},null,2),{mode:0o600});
console.log(`Backup saved: ${destination}`);
