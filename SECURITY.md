# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| latest  | Yes       |

## Reporting a Vulnerability

If you discover a security vulnerability, please report it responsibly:

1. **Do not** open a public issue
2. Email [florian@wartner.io](mailto:florian@wartner.io) with details
3. Include steps to reproduce if possible
4. Allow reasonable time for a fix before public disclosure

We will acknowledge receipt within 48 hours and aim to release a fix within 7 days for critical issues.

## Security Measures

This project implements the following security practices:

- Input validation on all API endpoints (field whitelists, enum validation, length limits)
- 1MB body size limit on all POST/PATCH/PUT requests
- Path traversal protection on static file serving
- No hardcoded credentials or private paths in source
- Environment variables for all configurable paths
- Prototype pollution prevention via explicit field copying
