using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Text;
using System.Windows.Forms;
using System.Xml.Serialization;

[assembly:System.Reflection.AssemblyTitle("CNC Pendant")]
[assembly:System.Reflection.AssemblyVersion("0.1.0.0")]
namespace MainsailCnc {
 public class Preferences { public string Address=""; public string Browser="Brave"; public bool Fullscreen=true; public bool Dashboard=false; }
 public static class Launcher {
  static readonly string Data=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"MainsailCNCPendant");
  static readonly string Config=Path.Combine(Data,"settings.xml");
  public static string Origin(string text) {
   text=(text??"").Trim(); if(text.Length==0||text.Any(char.IsControl)||text.Contains("\\")||text.Contains("\""))throw new ArgumentException("Enter the Pi's HTTP or HTTPS address.");
   if(!text.Contains("://"))text="http://"+text; Uri u;
   if(!Uri.TryCreate(text,UriKind.Absolute,out u)||(u.Scheme!="http"&&u.Scheme!="https")||String.IsNullOrEmpty(u.Host)||u.UserInfo.Length!=0||u.Port<=0)throw new ArgumentException("Use a machine address without a username or password.");
   return u.GetLeftPart(UriPartial.Authority).TrimEnd('/');
  }
  public static string Quote(string text) {
   var b=new StringBuilder("\"");int slashes=0;foreach(char c in text){if(c=='\\'){slashes++;continue;}if(c=='\"'){b.Append('\\',slashes*2+1);b.Append(c);}else{b.Append('\\',slashes);b.Append(c);}slashes=0;}b.Append('\\',slashes*2);return b.Append('"').ToString();
  }
  public static string BrowserPath(string name) {
   string rel=name=="Brave"?@"BraveSoftware\Brave-Browser\Application\brave.exe":name=="Chrome"?@"Google\Chrome\Application\chrome.exe":name=="Edge"?@"Microsoft\Edge\Application\msedge.exe":null;
   if(rel==null)throw new ArgumentException("Choose Brave, Chrome or Edge.");
   foreach(string folder in new[]{Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86),Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData)}){var path=Path.Combine(folder,rel);if(File.Exists(path))return path;}
   throw new FileNotFoundException(name+" is not installed. Choose another browser in CNC Pendant Settings.");
  }
  static Preferences Read(){if(!File.Exists(Config))return new Preferences();try{using(var stream=File.OpenRead(Config))return (Preferences)new XmlSerializer(typeof(Preferences)).Deserialize(stream);}catch{throw new IOException("Cannot read CNC Pendant settings. Open CNC Pendant Settings to save them again.");}}
  static void Save(Preferences p){Directory.CreateDirectory(Data);string temporary=Config+".tmp";using(var stream=File.Create(temporary))new XmlSerializer(typeof(Preferences)).Serialize(stream,p);if(File.Exists(Config))File.Replace(temporary,Config,Config+".previous");else File.Move(temporary,Config);}
  static bool Configure(Preferences p){
   using(var f=new Form()){f.Text="CNC Pendant — App settings";f.ClientSize=new Size(520,305);f.StartPosition=FormStartPosition.CenterScreen;f.FormBorderStyle=FormBorderStyle.FixedDialog;f.MaximizeBox=false;f.MinimizeBox=false;f.Font=new Font("Segoe UI",11);f.Icon=Icon.ExtractAssociatedIcon(Application.ExecutablePath);
    var address=new TextBox{Left=20,Top=45,Width=480,Text=p.Address};f.Controls.Add(new Label{Left=20,Top=15,Width=470,Text="Pi / machine address"});f.Controls.Add(address);
    var browser=new ComboBox{Left=20,Top=115,Width=160,DropDownStyle=ComboBoxStyle.DropDownList};browser.Items.AddRange(new object[]{"Brave","Chrome","Edge"});browser.SelectedItem=p.Browser;if(browser.SelectedIndex<0)browser.SelectedIndex=0;f.Controls.Add(new Label{Left=20,Top=85,Width=470,Text="Dedicated browser session"});f.Controls.Add(browser);
    var full=new CheckBox{Left=205,Top=116,Width=290,Text="Open full screen (F11 to leave)",Checked=p.Fullscreen};f.Controls.Add(full);
    var dash=new CheckBox{Left=20,Top=158,Width=480,Text="Open expanded Mainsail dashboard",Checked=p.Dashboard};f.Controls.Add(dash);
    f.Controls.Add(new Label{Left=20,Top=194,Width=480,Height=45,Text="Uses a separate browser profile. CNC settings still load from the Pi. This launcher sends no machine commands."});
    var save=new Button{Left=270,Top=253,Width=110,Text="Save"};var cancel=new Button{Left=390,Top=253,Width=110,Text="Cancel",DialogResult=DialogResult.Cancel};f.Controls.Add(save);f.Controls.Add(cancel);f.CancelButton=cancel;f.AcceptButton=save;
    save.Click+=(o,e)=>{try{p.Address=Origin(address.Text);p.Browser=browser.SelectedItem.ToString();BrowserPath(p.Browser);p.Fullscreen=full.Checked;p.Dashboard=dash.Checked;Save(p);f.DialogResult=DialogResult.OK;f.Close();}catch(Exception x){MessageBox.Show(f,x.Message,"Check app settings");}};return f.ShowDialog()==DialogResult.OK;
   }
  }
  public static string Arguments(Preferences p){string profile=Path.Combine(Data,"BrowserProfile",p.Browser);string url=Origin(p.Address)+(p.Dashboard?"/":"/cnc-pendant.html");return "--user-data-dir="+Quote(profile)+" --no-first-run --no-default-browser-check --app="+Quote(url)+(p.Fullscreen?" --start-fullscreen":" --start-maximized");}
  [STAThread] public static int Main(string[] args){
   Application.EnableVisualStyles();Application.SetCompatibleTextRenderingDefault(false);
   try{
    bool configure=args.Contains("--configure");Preferences p;try{p=Read();}catch{if(!configure)throw;p=new Preferences();}
    if(configure||String.IsNullOrWhiteSpace(p.Address)){if(!Configure(p))return 0;if(configure)return 0;}
    if(args.Contains("--dashboard"))p.Dashboard=true;
    Process.Start(new ProcessStartInfo{FileName=BrowserPath(p.Browser),Arguments=Arguments(p),UseShellExecute=false,WorkingDirectory=Data});return 0;
   }catch(Exception e){MessageBox.Show(e.Message,"CNC Pendant",MessageBoxButtons.OK,MessageBoxIcon.Information);return 1;}
  }
 }
}
