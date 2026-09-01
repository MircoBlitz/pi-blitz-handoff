# Security Policy

## Supported versions

Security fixes are provided for the latest published version of pi-simple-handoff.

## Reporting a vulnerability

Do not open a public issue for an undisclosed vulnerability. Use [GitHub Private Vulnerability Reporting](https://github.com/MircoBlitz/pi-simple-handoff/security/advisories/new). If that is unavailable, email `simplehandoff@edelhack.de`. Include:

- the affected version;
- a concise description and expected impact;
- reproduction steps or a minimal proof of concept;
- any relevant Pi, Node.js, operating-system, and terminal versions.

Do not include credentials, tokens, private keys, or unrelated personal data. Public disclosure should wait until a fix or mitigation is available.

## Trust boundary

Pi packages execute with the permissions of the user running Pi. pi-simple-handoff narrows the model's active Pi tool set while the handoff is written, but it is not an operating-system sandbox. See the README's transparency and safety sections for the complete data flow and limitations.
