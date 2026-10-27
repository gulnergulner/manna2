import fs from "node:fs";
const lock = JSON.parse(fs.readFileSync("package-lock.json", "utf8"));
const file = "apps/web/package.json";
const pkg = JSON.parse(fs.readFileSync(file, "utf8"));
for (const group of ["dependencies", "devDependencies"])
  for (const name of Object.keys(pkg[group]))
    pkg[group][name] = lock.packages[`node_modules/${name}`].version;
pkg.engines = { node: "24.x" };
fs.writeFileSync(file, JSON.stringify(pkg, null, 2) + "\n");
