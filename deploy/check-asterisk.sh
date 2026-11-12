#!/bin/bash
echo "=== VERSION ==="
asterisk -rx "core show version"
echo "=== PJSIP MODULES ==="
asterisk -rx "module show like pjsip" | head -20
echo "=== TRANSPORTS ==="
asterisk -rx "pjsip show transports"
echo "=== REGISTRATIONS ==="
asterisk -rx "pjsip show registrations"
echo "=== ENDPOINTS ==="
asterisk -rx "pjsip show endpoints" | head -40
echo "=== AORS ==="
asterisk -rx "pjsip show aors" | head -20
