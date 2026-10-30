import pathlib,os,json,subprocess,shutil,fcntl,time,tempfile,datetime
from deploy_utils import *
from backup_active_environment import read_active_environment
os.umask(0o077)
lock=open('/run/houren-deploy.lock','a');fcntl.flock(lock,fcntl.LOCK_EX)
env,code=read_active_environment();data=pathlib.Path(env['DATA_DIR'])
if not data.is_absolute():data=code/data
base=pathlib.Path('/var/backups/houren/hourly');base.mkdir(mode=0o700,parents=True,exist_ok=True)
stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ');out=base/stamp;out.mkdir(mode=0o700)
scriptRoot=pathlib.Path(__file__).parent
for attempt in range(3):
 work=pathlib.Path(tempfile.mkdtemp(prefix='.snapshot-',dir=out))
 try:
  shutil.copytree(data,work/'data',symlinks=True)
  save(work/'effective-env.private.json',env)
  os.chmod(work/'effective-env.private.json',0o600)
  with (out/'verification.log').open('ab') as log:
   subprocess.run([NODE,str(scriptRoot/'offline.mjs'),str(code),str(work/'data'),str(work/'effective-env.private.json'),str(out/'worlds.json'),'allow-tail'],stdout=log,stderr=log,check=True)
  subprocess.run(['tar','--acls','--xattrs','--numeric-owner','-czpf',str(out/'data.tar.gz'),'-C',str(work),'data'],check=True)
  subprocess.run(['tar','--acls','--xattrs','--numeric-owner','-czpf',str(out/'config.tar.gz'),'-C','/','etc/houren','etc/systemd/system/houren.service','etc/systemd/system/houren.service.d','etc/nginx'],check=True)
  for name in ['data.tar.gz','config.tar.gz']:
   with open(os.devnull,'wb') as null:subprocess.run(['tar','-tzf',str(out/name)],stdout=null,check=True)
  save(out/'manifest.json',{'completedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'release':str(code),'sha256':{n:digest(out/n) for n in ['data.tar.gz','config.tar.gz']},'worlds':json.loads((out/'worlds.json').read_text()),'method':'isolated copy, command-tail recovery and full replay; no production stop or model activation'})
  print(json.dumps({'status':'ok','directory':str(out)}));break
 except Exception:
  if attempt==2:raise
  time.sleep(2)
 finally:shutil.rmtree(work)
