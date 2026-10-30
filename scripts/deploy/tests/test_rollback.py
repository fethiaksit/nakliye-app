import json, os, pathlib, subprocess, tempfile, unittest
SCRIPT = pathlib.Path(__file__).resolve().parents[1] / 'rollback.sh'
class RollbackTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.root=pathlib.Path(self.tmp.name)
  self.base=self.root/'compose.yml';self.base.write_text('services:\n  backend:\n    image: current\n')
  self.env=os.environ.copy();self.env.update(ROLLBACK_STATE_DIR=str(self.root/'state'),DEPLOY_CONTAINER_NAME='nakliye-beta-backend-1',DEPLOY_HEALTH_URL='http://127.0.0.1:8081/health/ready',MOCK_BASE=str(self.base),MOCK_LOG=str(self.root/'docker.log'))
  self.env['PATH']=str(self.root)+os.pathsep+self.env['PATH']
  (self.root/'docker').write_text('''#!/usr/bin/env python3
import json,os,sys
with open(os.environ['MOCK_LOG'],'a') as f:f.write(json.dumps(sys.argv[1:])+'\\n')
a=sys.argv[1:]
if a[0]=='inspect':
 if os.environ.get('MOCK_INSPECT_FAIL'):sys.exit(1)
 fmt=next((x.split('=',1)[1] if '=' in x else a[i+1] for i,x in enumerate(a) if x.startswith('--format')), '')
 if '.Config.Image' in fmt:print('current:tag')
 elif '.Image' in fmt:print('sha256:1111')
 elif 'compose.project.config_files' in fmt:print(os.environ['MOCK_BASE'])
 elif 'compose.project.working_dir' in fmt:print(os.path.dirname(os.environ['MOCK_BASE']))
 elif 'compose.project' in fmt:print('nakliye-beta')
 elif 'compose.service' in fmt:print('backend')
 elif 'Health' in fmt:print('healthy')
 else:sys.exit(3)
elif a[0]=='image':sys.exit(0)
elif a[0]=='compose':sys.exit(0)
elif a[0]=='rm':sys.exit(90)
elif a[0]=='ps':print('nakliye-beta-backend-1')
else:sys.exit(3)
''');(self.root/'docker').chmod(0o755)
  (self.root/'curl').write_text('#!/bin/sh\nexit 0\n');(self.root/'curl').chmod(0o755)
 def run_script(self,*args):return subprocess.run(['bash',str(SCRIPT),*args],env=self.env,text=True,capture_output=True)
 def test_record_uses_requested_container_and_immutable_image(self):
  self.env.pop('DEPLOY_CONTAINER_NAME')
  r=self.run_script('--record-current','nakliye-beta-backend-1');self.assertEqual(r.returncode,0,r.stderr)
  p=self.root/'state/nakliye-beta-backend-1.last_good_image';self.assertTrue(p.exists(),r.stdout);self.assertEqual(p.read_text().strip(),'sha256:1111')
 def test_failed_record_does_not_destroy_last_good_image(self):
  state=self.root/'state';state.mkdir();previous=state/'nakliye-beta-backend-1.last_good_image';previous.write_text('sha256:last-good\n')
  self.env['MOCK_INSPECT_FAIL']='1';r=self.run_script('--record-current')
  self.assertNotEqual(r.returncode,0);self.assertEqual(previous.read_text().strip(),'sha256:last-good')
 def test_rollback_preserves_compose_and_never_removes_redis_or_backend(self):
  r=self.run_script('previous:local');self.assertEqual(r.returncode,0,r.stdout+r.stderr)
  calls=[json.loads(x) for x in (self.root/'docker.log').read_text().splitlines()]
  self.assertFalse(any(x[0] in ('rm','run','volume') for x in calls),calls)
  up=[x for x in calls if x[0]=='compose' and 'up' in x];self.assertEqual(len(up),1,calls)
  self.assertIn('--no-deps',up[0]);self.assertIn('--no-build',up[0]);self.assertEqual(up[0][-1],'backend')
if __name__=='__main__':unittest.main()
