# shadcn Registry security

Registry output is untrusted source material. Paths reject traversal, absolute paths, drive/UNC paths, `.git`, `.env`, `node_modules`, `.next`, `dist`, and `coverage`. Only bounded UTF-8 text is accepted. Scanning blocks critical environment access, child process/filesystem access, dynamic code, installation commands, destructive commands, and infrastructure access; network and prompt-injection findings are recorded or blocked according to severity.

No raw registry response, credential, full source corpus, or customer file is sent to the provider. There is no shell, npm, `npx shadcn add`, or filesystem write path in the Registry port.
