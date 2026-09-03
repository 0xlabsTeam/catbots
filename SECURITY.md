# Security policy

Please report suspected vulnerabilities privately through this repository's GitHub Security advisory flow. Do not open a public issue for a vulnerability until maintainers have had an opportunity to assess and coordinate a fix.

Reports must not include API keys, wallet material, `local.env.yaml`, database files, logs containing credentials, or any other secret. Redact reproduction steps and use placeholder values such as `replace-me`.

Catbots M0 stores local configuration on the user's machine and deliberately has no cloud telemetry or master-wallet-key support. Treat local configuration and SQLite data as sensitive.
