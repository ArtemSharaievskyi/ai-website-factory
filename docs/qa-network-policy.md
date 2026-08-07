# QA Network Policy

Browser navigation and requests are limited to the assigned `http://127.0.0.1:<port>` loopback origin. External, LAN, file, data, JavaScript, browser-extension, HTTPS, and wrong-port URLs are rejected. External browser requests are blocked and recorded as `QA_EXTERNAL_REQUEST_BLOCKED`.
