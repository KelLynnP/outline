// Load the repo-root .env regardless of cwd (npm workspace scripts run from
// backend/, where dotenv's default lookup finds nothing).
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, "..", "..", ".env") });
