#!/usr/bin/env python3
"""Check the resolved production Compose configuration without printing credentials or contacting a CA."""
import json
import re
import subprocess
from urllib.parse import urlsplit


def validate(config):
    """Detect origin/proxy/cookie/bind mistakes before starting the production package.

    This checks configuration only. DNS, public ports, certificates and real-device
    GPS still need validation on the actual deployment host.
    """
    services=config.get('services',{});problems=[]
    api=services.get('api',{}).get('environment',{})
    proxy=services.get('https',{}).get('environment',{})
    domain=proxy.get('APP_DOMAIN','')
    if not isinstance(domain,str)or not re.fullmatch(r'(?=.{1,253}$)(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,63}',domain):
        problems.append('APP_DOMAIN must be a hostname without a scheme, port or path')
    origin=api.get('APP_ORIGIN','')
    hostname=domain.lower()if isinstance(domain,str)else''
    try:
        url=urlsplit(origin)
        if origin!='https://'+hostname or url.scheme!='https'or url.hostname!=hostname or url.port not in(None,443)or url.path or url.query or url.fragment or url.username or url.password:
            problems.append('APP_ORIGIN must be the exact HTTPS origin for APP_DOMAIN, without a trailing slash')
    except(ValueError,TypeError):problems.append('Invalid APP_ORIGIN')
    if api.get('APP_ENV')!='production':problems.append('APP_ENV must be production for Secure cookies')
    password=services.get('db',{}).get('environment',{}).get('POSTGRES_PASSWORD','')
    if not isinstance(password,str)or len(password)<16 or password in['replace-with-a-strong-local-password','gtt_compose_ci_only','gtt_ci_only']:
        problems.append('Set a private non-example POSTGRES_PASSWORD of at least 16 characters')
    for service in ['db','web']:
        for port in services.get(service,{}).get('ports',[]):
            if port.get('host_ip')not in['127.0.0.1','::1']:problems.append(service+' must bind host ports only to loopback')
    if 'backups'not in services:problems.append('Daily backup service is missing')
    if 'https'not in services.get('web',{}).get('depends_on',{}):problems.append('Start the proxy before web resolves its trusted address')
    return problems


def main():
    """Read Compose's resolved JSON in memory and report only sanitized configuration errors."""
    result=subprocess.run(['docker','compose','-f','docker-compose.yml','-f','docker-compose.production.yml','config','--format','json'],capture_output=True,text=True)
    if result.returncode:raise SystemExit('Compose configuration failed; check required values in .env')
    problems=validate(json.loads(result.stdout))
    if problems:
        print('\n'.join(problems));raise SystemExit(1)
    print('Production configuration valid; credentials were not printed. Verify DNS/TLS/GPS on the deployment host.')


if __name__=='__main__':main()
