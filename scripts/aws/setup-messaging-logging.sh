#!/usr/bin/env bash
# Provisions AWS resources for End User Messaging event logging and the
# technical-officer log-viewer IAM group. Run manually with an AWS profile
# that has IAM + End User Messaging admin permissions:
#
#   AWS_PROFILE=<admin-profile> AWS_REGION=us-east-1 ./scripts/aws/setup-messaging-logging.sh
#
# Not safe to blindly re-run: IAM/log resources that already exist will
# cause "already exists" errors. Review before running, and comment out
# steps that already succeeded if you need to re-run after a partial
# failure.
set -euo pipefail

: "${AWS_REGION:?Set AWS_REGION, e.g. us-east-1}"
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

CONFIG_SET_NAME="horsemen-member-messaging"
LOG_GROUP_NAME="/aws/eum/horsemen-member-messaging"
LOG_ROLE_NAME="horsemen-eum-logging-role"
VIEWER_GROUP_NAME="horsemen-messaging-viewers"
VIEWER_POLICY_NAME="horsemen-messaging-logs-readonly"

echo "== 1. CloudWatch Logs log group =="
aws logs create-log-group --log-group-name "$LOG_GROUP_NAME"
aws logs put-retention-policy --log-group-name "$LOG_GROUP_NAME" --retention-in-days 30

LOG_GROUP_ARN="arn:aws:logs:${AWS_REGION}:${ACCOUNT_ID}:log-group:${LOG_GROUP_NAME}:*"

echo "== 2. IAM role for End User Messaging to write to CloudWatch Logs =="
TRUST_POLICY=$(cat <<EOF
{
  "Version": "2012-10-17",
  "Statement": {
    "Effect": "Allow",
    "Principal": { "Service": "sms-voice.amazonaws.com" },
    "Action": "sts:AssumeRole",
    "Condition": {
      "StringEquals": { "aws:SourceAccount": "${ACCOUNT_ID}" },
      "ArnLike": { "aws:SourceArn": "arn:aws:sms-voice:${AWS_REGION}:${ACCOUNT_ID}:configuration-set/${CONFIG_SET_NAME}" }
    }
  }
}
EOF
)

aws iam create-role \
  --role-name "$LOG_ROLE_NAME" \
  --assume-role-policy-document "$TRUST_POLICY"

PERMISSIONS_POLICY=$(cat <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["logs:CreateLogStream", "logs:DescribeLogStreams", "logs:PutLogEvents"],
      "Resource": ["${LOG_GROUP_ARN}"]
    }
  ]
}
EOF
)

aws iam put-role-policy \
  --role-name "$LOG_ROLE_NAME" \
  --policy-name eum-cloudwatch-logs \
  --policy-document "$PERMISSIONS_POLICY"

LOG_ROLE_ARN=$(aws iam get-role --role-name "$LOG_ROLE_NAME" --query 'Role.Arn' --output text)

echo "Waiting 10s for IAM role propagation..."
sleep 10

echo "== 3. End User Messaging configuration set + event destination =="
aws pinpoint-sms-voice-v2 create-configuration-set --configuration-set-name "$CONFIG_SET_NAME"

aws pinpoint-sms-voice-v2 create-event-destination \
  --configuration-set-name "$CONFIG_SET_NAME" \
  --event-destination-name cloudwatch-logs \
  --matching-event-types ALL \
  --cloud-watch-logs-destination "IamRoleArn=${LOG_ROLE_ARN},LogGroupArn=${LOG_GROUP_ARN}"

echo "== 4. IAM group + read-only policy for technical officers =="
VIEWER_POLICY=$(cat <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "logs:FilterLogEvents",
        "logs:GetLogEvents",
        "logs:DescribeLogGroups",
        "logs:DescribeLogStreams",
        "logs:StartQuery",
        "logs:GetQueryResults",
        "logs:StopQuery"
      ],
      "Resource": ["${LOG_GROUP_ARN}"]
    }
  ]
}
EOF
)

aws iam create-group --group-name "$VIEWER_GROUP_NAME"
VIEWER_POLICY_ARN=$(aws iam create-policy \
  --policy-name "$VIEWER_POLICY_NAME" \
  --policy-document "$VIEWER_POLICY" \
  --query 'Policy.Arn' --output text)
aws iam attach-group-policy --group-name "$VIEWER_GROUP_NAME" --policy-arn "$VIEWER_POLICY_ARN"

echo
echo "Done. Resources created:"
echo "  Log group:         $LOG_GROUP_NAME (30-day retention)"
echo "  EUM config set:     $CONFIG_SET_NAME"
echo "  Viewer IAM group:   $VIEWER_GROUP_NAME"
echo
echo "Next steps (manual):"
echo "  1. Add each technical officer as an IAM user in $VIEWER_GROUP_NAME:"
echo "       aws iam create-user --user-name <name>"
echo "       aws iam add-user-to-group --user-name <name> --group-name $VIEWER_GROUP_NAME"
echo "       aws iam create-login-profile --user-name <name> --password-reset-required"
echo "  2. Attach sms-voice:SendTextMessage plus these read-only CloudWatch Logs actions"
echo "     to whatever IAM identity your Netlify site's AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY"
echo "     belong to (needed for /api/message-logs):"
echo "       logs:StartQuery, logs:GetQueryResults, logs:DescribeLogGroups"
echo "       on resource: $LOG_GROUP_ARN"
echo "  3. Set MESSAGE_USERS_JSON in Netlify env vars (Site settings > Environment variables), e.g.:"
echo '       [{"name":"Barry","token":"<random-string>"},{"name":"Jane","token":"<random-string>"}]'
