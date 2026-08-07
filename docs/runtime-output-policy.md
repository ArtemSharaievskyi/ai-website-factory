# Runtime Output Policy

 stdout and stderr are retained only as bounded summaries. Long lines and total output are truncated, common credentials and absolute paths are redacted, and byte counts plus truncation state are recorded. Reports contain safe failure codes rather than raw command construction or secrets.
