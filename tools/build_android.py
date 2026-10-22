import pathlib,subprocess,os,zipfile
import argparse
parser=argparse.ArgumentParser(description='Build and sign the CNC Pendant preview APK with official Android SDK tools.')
parser.add_argument('--jdk-dir',type=pathlib.Path,required=True)
parser.add_argument('--sdk-dir',type=pathlib.Path,required=True)
parser.add_argument('--build-tools',default='35.0.0')
args=parser.parse_args()
project=pathlib.Path(__file__).resolve().parents[1];root=project/'android';build=root/'build';build.mkdir(exist_ok=True)
jdk=args.jdk_dir.resolve();tools=args.sdk_dir.resolve()/'build-tools'/args.build_tools;platform=args.sdk_dir.resolve()/'platforms/android-35/android.jar';env=os.environ.copy();env['JAVA_HOME']=str(jdk);env['PATH']=str(jdk/'bin')+os.pathsep+env['PATH']
suffix='.exe' if os.name=='nt' else ''
def run(*args):
 print('Build step:',pathlib.Path(args[0]).name,flush=True);subprocess.run([str(x) for x in args],check=True,env=env,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
for name in ['gen','classes','dex']:(build/name).mkdir(exist_ok=True)
run(tools/('aapt'+suffix),'package','-f','-m','-M',root/'AndroidManifest.xml','-S',root/'res','-I',platform,'-J',build/'gen')
source=list((root/'src').rglob('*.java'))+list((build/'gen').rglob('*.java'))
run(jdk/('bin/javac'+suffix),'-source','8','-target','8','-encoding','UTF-8','-classpath',platform,'-d',build/'classes',*source)
with zipfile.ZipFile(build/'classes.jar','w') as jar:
 for f in (build/'classes').rglob('*.class'):jar.write(f,f.relative_to(build/'classes').as_posix())
run(jdk/('bin/java'+suffix),'-cp',tools/'lib/d8.jar','com.android.tools.r8.D8','--min-api','26','--lib',platform,'--output',build/'dex',build/'classes.jar')
run(tools/('aapt'+suffix),'package','-f','-M',root/'AndroidManifest.xml','-S',root/'res','-I',platform,'-F',build/'unsigned.apk')
with zipfile.ZipFile(build/'unsigned.apk','a') as apk:apk.write(build/'dex/classes.dex','classes.dex')
run(tools/('zipalign'+suffix),'-f','4',build/'unsigned.apk',build/'aligned.apk')
key=build/'preview.keystore'
if not key.exists():run(jdk/('bin/keytool'+suffix),'-genkeypair','-keystore',key,'-storepass','android','-alias','androiddebugkey','-keypass','android','-keyalg','RSA','-keysize','2048','-validity','10000','-dname','CN=CNC Pendant Preview,O=Development,C=US')
output=build/'CNC-Pendant-preview.apk'
run(jdk/('bin/java'+suffix),'-jar',tools/'lib/apksigner.jar','sign','--ks',key,'--ks-pass','pass:android','--key-pass','pass:android','--out',output,build/'aligned.apk')
run(jdk/('bin/java'+suffix),'-jar',tools/'lib/apksigner.jar','verify',output)
print('Verified signed APK:',output,output.stat().st_size,flush=True)
