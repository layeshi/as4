#!/bin/sh
# 在服务器控制台运行；仅检查，不重启、不修改配置、不输出环境或密钥。
date -Is
systemctl is-active houren nginx xray ssh
systemctl show houren nginx xray ssh --property=Id,ActiveState,SubState,MainPID,NRestarts,ActiveEnterTimestamp
ss -lntp '( sport = :80 or sport = :443 or sport = :53251 or sport = :9443 or sport = :8787 or sport = :2443 )'
nginx -t
curl --connect-timeout 3 --max-time 5 -sS -o /dev/null -w 'backend HTTP %{http_code}\n' http://127.0.0.1:8787/api/account
curl --connect-timeout 3 --max-time 5 -sS --resolve www.heirscity.site:443:127.0.0.1 -o /dev/null -w 'local HTTPS %{http_code}\n' https://www.heirscity.site/api/account
