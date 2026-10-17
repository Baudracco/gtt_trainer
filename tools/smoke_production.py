"""Validate production proxy configuration in disposable CI without issuing a certificate."""
import os
import subprocess
import uuid

if os.environ.get('GTT_ISOLATED_CI')!='1':raise SystemExit('Use only in disposable Compose CI')
environment=dict(os.environ,APP_DOMAIN='trainer.example.invalid',APP_ORIGIN='https://trainer.example.invalid',POSTGRES_PASSWORD='synthetic_only_0123456789')
compose=['docker','compose','-f','docker-compose.yml','-f','docker-compose.production.yml']
container='gtt-ci-proxy-dns-'+uuid.uuid4().hex[:8]


def run(args):
    """Keep resolved secrets/config in memory and print only validation summaries."""
    subprocess.run(args,env=environment,check=True,stdout=subprocess.DEVNULL)


try:
    run(['python3','tools/check_production.py'])
    run(compose+['run','--rm','--no-deps','https','caddy','validate','--config','/etc/caddy/Caddyfile','--adapter','caddyfile'])
    # A sleeping DNS peer lets nginx resolve the trusted service while syntax is
    # checked. No Caddy server starts and no public CA/network request is made.
    run(compose+['run','-d','--no-deps','--use-aliases','--name',container,'--entrypoint','sh','https','-c','sleep 60'])
    run(compose+['run','--rm','--no-deps','web','nginx','-t'])
    print('Production Compose, exact HTTPS origin, Caddy provisioning and Nginx trusted-proxy syntax passed without requesting certificates.')
finally:
    subprocess.run(['docker','rm','-f',container],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
