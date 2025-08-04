import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path, { sep } from "node:path";

import { debug, getInput, setFailed } from "@actions/core";

const scriptUrl =
  "https://raw.githubusercontent.com/rhysd/actionlint/main/scripts/download-actionlint.bash";

const main = async () => {
  debug(`Fetching download-actionlint.bash from ${scriptUrl}`);
  const scriptResponse = await fetch(scriptUrl);
  debug(`Fetch response status code: ${scriptResponse.status.toString()}`);

  const scriptText = await scriptResponse.text();
  const actualHash = createHash("sha256").update(scriptText).digest("hex");

  const expectedHash = getInput("expected-hash", { required: true });
  const actionLintVersion = getInput("actionlint-version", { required: true });

  if (actualHash !== expectedHash) {
    setFailed(
      `Could not verify hash of remote script. Expected: ${expectedHash}, actual: ${actualHash}`
    );
    return;
  }

  const tempDir = mkdtempSync(`${tmpdir()}${sep}`);
  const tempPath = path.join(tempDir, "download-actionlint.bash");
  debug(`Downloading download-actionlint.bash to "${tempPath}"`);

  writeFileSync(tempPath, scriptText);

  try {
    debug(`Installing actionlint version ${actionLintVersion}`);
    execSync(`bash ${tempPath} "${actionLintVersion}"`, {
      stdio: "inherit",
    });
  } finally {
    debug("Cleaning up temporary directory");
    rmSync(tempDir, { recursive: true });
  }
};

await main();
