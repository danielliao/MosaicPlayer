# Security

Do not post passwords, device URLs containing keys, screenshots of customer content,
keystores, database dumps, kubeconfigs, registry credentials, or private deployment
addresses in public issues or pull requests. If GitHub private vulnerability reporting
is available, use the repository's Security tab to report a vulnerability privately.

The multi-tenant backend requires a separate non-owner runtime database role without
SUPERUSER or BYPASSRLS. Migration and bootstrap credentials must not be injected into
the running web application. Use HTTPS for untrusted networks; the legacy JSON backend
and HTTP development configuration are intended for trusted local networks only.

Android updates verify the package identity, version, digest, certificate and current
installation authorization. Configure the SHA256 fingerprint of **your own trusted APK
certificate**, or use the locally built baseline APK. Never disable signature checks.
Protect and back up `android/.signing/`; losing it prevents compatible signed updates.
The macOS server kit records the certificate of the APK included during its build.

Generated credentials, device pairings and backups belong outside version control.
Rotate credentials if they were ever published; removing a file does not erase Git
history. Avoid attaching raw logs or environment files to issues.

A source checkout or passing unit tests does not establish suitability for a public
production deployment. Validate access control, backup recovery, network permissions,
and real devices in the intended environment.
