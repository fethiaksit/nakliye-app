import os,pathlib,subprocess,tempfile,unittest
SCRIPT=pathlib.Path(__file__).resolve().parents[1]/'health-check.sh'
class HealthChecks(unittest.TestCase):
 def test_healthy_and_all_requested_failure_classes(self):
  with tempfile.TemporaryDirectory() as d:
   root=pathlib.Path(d)
   tools={'docker':'''#!/bin/sh
case "$1" in inspect) echo healthy;; exec) echo "${PING:-PONG}";; logs) printf '%s\\n' "${LOGS:-}";; esac
''','curl':'#!/bin/sh\nexit "${HTTP_FAILURE:-0}"\n','df':'#!/bin/sh\nprintf "Filesystem Blocks Used Avail Capacity Mounted\\nroot 100 40 60 %s%% /\\n" "${DISK:-40}"\n'}
   for name,source in tools.items():p=root/name;p.write_text(source);p.chmod(0o755)
   env=os.environ.copy();env['PATH']=d+os.pathsep+env['PATH']
   for extra,word in [({},'OK'),({'DISK':'90'},'disk'),({'PING':'failed'},'Redis'),({'HTTP_FAILURE':'1'},'readiness'),({'LOGS':'http_request status=503'},'5xx'),({'LOGS':'password_reset_email_failed'},'email'),({'LOGS':'push receipt check failed'},'push')]:
    with self.subTest(extra=extra):
     r=subprocess.run(['bash',str(SCRIPT)],env={**env,**extra},capture_output=True,text=True)
     self.assertEqual(r.returncode,0 if not extra else 1,r.stderr);self.assertIn(word,r.stdout)
if __name__=='__main__':unittest.main()

class AlertWrapper(unittest.TestCase):
 def test_existing_sns_is_reused_and_health_alerts_are_throttled(self):
  wrapper=pathlib.Path(__file__).resolve().parents[2]/'backup/backup-alert.sh'
  with tempfile.TemporaryDirectory() as d:
   root=pathlib.Path(d);(root/'backup').mkdir();(root/'ops').mkdir()
   (root/'ops/health-check.sh').write_text('#!/bin/sh\nexit 1\n');(root/'ops/health-check.sh').chmod(0o755)
   (root/'aws').write_text('#!/bin/sh\necho publish >> "$MOCK_ALERT_LOG"\nexit 0\n');(root/'aws').chmod(0o755)
   env={**os.environ,'PATH':d+os.pathsep+os.environ['PATH'],'BACKUP_SCRIPT_DIR':str(root/'backup'),'OPS_ALERT_STATE_DIR':str(root/'state'),'MOCK_ALERT_LOG':str(root/'calls')}
   for _ in range(2):
    result=subprocess.run(['bash',str(wrapper),'health','all'],env=env,capture_output=True,text=True);self.assertEqual(result.returncode,1,result.stderr)
   self.assertEqual((root/'calls').read_text().splitlines(),['publish'])
