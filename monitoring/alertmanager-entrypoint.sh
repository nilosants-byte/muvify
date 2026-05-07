#!/bin/sh
set -e

CONFIG=/etc/alertmanager/alertmanager.yml

RECEIVER_WEBHOOK=""
RECEIVER_EMAIL=""
RECEIVER_SLACK=""

if [ -n "$ALERT_WEBHOOK_URL" ]; then
  RECEIVER_WEBHOOK="webhook"
fi

if [ -n "$ALERT_SLACK_WEBHOOK" ]; then
  RECEIVER_SLACK="slack"
fi

if [ -n "$ALERT_EMAIL_TO" ] && [ -n "$ALERT_SMTP_HOST" ]; then
  RECEIVER_EMAIL="email"
fi

cat > "$CONFIG" <<YAML
route:
  receiver: "default"
  group_wait: 30s
  group_interval: 5m
  repeat_interval: 4h
YAML

if [ -n "$RECEIVER_WEBHOOK" ] || [ -n "$RECEIVER_EMAIL" ] || [ -n "$RECEIVER_SLACK" ]; then
  echo "  routes:" >> "$CONFIG"
fi

if [ -n "$RECEIVER_SLACK" ]; then
  cat >> "$CONFIG" <<YAML
    - receiver: "slack"
      continue: true
YAML
fi

if [ -n "$RECEIVER_WEBHOOK" ]; then
  cat >> "$CONFIG" <<YAML
    - receiver: "webhook"
      continue: true
YAML
fi

if [ -n "$RECEIVER_EMAIL" ]; then
  cat >> "$CONFIG" <<YAML
    - receiver: "email"
YAML
fi

cat >> "$CONFIG" <<YAML

receivers:
  - name: "default"
YAML

if [ -n "$RECEIVER_SLACK" ]; then
  cat >> "$CONFIG" <<YAML
  - name: "slack"
    slack_configs:
      - api_url: "$ALERT_SLACK_WEBHOOK"
        channel: "${ALERT_SLACK_CHANNEL:-}"
        username: "${ALERT_SLACK_USERNAME:-alertmanager}"
        send_resolved: true
YAML
fi

if [ -n "$RECEIVER_WEBHOOK" ]; then
  cat >> "$CONFIG" <<YAML
  - name: "webhook"
    webhook_configs:
      - url: "$ALERT_WEBHOOK_URL"
YAML
fi

if [ -n "$RECEIVER_EMAIL" ]; then
  cat >> "$CONFIG" <<YAML
  - name: "email"
    email_configs:
      - to: "$ALERT_EMAIL_TO"
        from: "${ALERT_EMAIL_FROM:-no-reply@localhost}"
        smarthost: "${ALERT_SMTP_HOST}:${ALERT_SMTP_PORT:-587}"
        auth_username: "${ALERT_SMTP_USER:-}"
        auth_password: "${ALERT_SMTP_PASS:-}"
        require_tls: ${ALERT_SMTP_TLS:-true}
YAML
fi

exec /bin/alertmanager --config.file="$CONFIG"
