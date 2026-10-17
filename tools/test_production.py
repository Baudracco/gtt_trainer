"""Configuration checks with synthetic secrets/domains; no network, CA or deployment changes."""
import unittest

from check_production import validate


def config():
    return {'services':{'api':{'environment':{'APP_ENV':'production','APP_ORIGIN':'https://trainer.example.invalid'}},
        'https':{'environment':{'APP_DOMAIN':'trainer.example.invalid'}},
        'db':{'environment':{'POSTGRES_PASSWORD':'synthetic_only_0123456789'},'ports':[{'host_ip':'127.0.0.1'}]},
        'web':{'ports':[{'host_ip':'127.0.0.1'}],'depends_on':{'https':{}}},'backups':{}}}


class ProductionTests(unittest.TestCase):
    def test_complete_configuration_and_exact_origin(self):
        self.assertEqual(validate(config()),[])
        for origin in ['http://trainer.example.invalid','https://trainer.example.invalid/','https://trainer.example.invalid:443',
                       'https://TRAINER.example.invalid','https://trainer.example.invalid?x=1','https://user:secret@trainer.example.invalid']:
            current=config();current['services']['api']['environment']['APP_ORIGIN']=origin
            self.assertTrue(validate(current))

    def test_insecure_cookie_binds_and_placeholder_secret(self):
        for service,field,value in [('api','APP_ENV','development'),('db','POSTGRES_PASSWORD','replace-with-a-strong-local-password'),('https','APP_DOMAIN','https://trainer.example.invalid')]:
            current=config();current['services'][service]['environment'][field]=value
            problems=validate(current);self.assertTrue(problems);self.assertNotIn('synthetic_only_0123456789',' '.join(problems))
        current=config();current['services']['web']['ports'][0]['host_ip']='0.0.0.0'
        self.assertTrue(validate(current))


if __name__=='__main__':unittest.main()
