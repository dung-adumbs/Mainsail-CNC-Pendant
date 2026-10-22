package org.mainsailcnc.pendant;
import android.app.*;
import android.os.*;
import android.content.*;
import android.net.Uri;
import android.graphics.Color;
import android.view.*;
import android.webkit.*;
import android.widget.*;

/** A narrow WebView shell. It never injects machine commands or a JavaScript bridge. */
public final class MainActivity extends Activity {
 private WebView web;
 private String address;
 private android.content.SharedPreferences preferences;
 @Override public void onCreate(Bundle state){super.onCreate(state);preferences=getSharedPreferences("pendant",MODE_PRIVATE);applyAppPreferences();address=preferences.getString("address","");if(!address.isEmpty()){try{address=checked(address);preferences.edit().putString("address",address).commit();}catch(Exception invalid){address="";}}if(address.isEmpty())settings();else open();handleIntent(getIntent());}
 private int dp(int value){return Math.round(value*getResources().getDisplayMetrics().density);}
 private void applyAppPreferences(){
  if(preferences.getBoolean("keep_screen_on",true))getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
  else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
  immersive();
 }
 private void immersive(){
  boolean full=preferences==null||preferences.getBoolean("full_screen",true);
  getWindow().getDecorView().setSystemUiVisibility(full?(View.SYSTEM_UI_FLAG_FULLSCREEN|View.SYSTEM_UI_FLAG_HIDE_NAVIGATION|View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY|View.SYSTEM_UI_FLAG_LAYOUT_STABLE|View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN|View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION):View.SYSTEM_UI_FLAG_VISIBLE);
 }
 private void showContent(View content){
  FrameLayout root=new FrameLayout(this);root.setBackgroundColor(Color.rgb(23,23,23));root.addView(content,new FrameLayout.LayoutParams(-1,-1));
  Button gear=new Button(this);gear.setText("⚙");gear.setContentDescription("App settings");gear.setTextSize(22);gear.setTextColor(Color.WHITE);gear.setPadding(0,0,0,0);gear.setMinWidth(0);gear.setMinimumWidth(0);gear.setMinHeight(0);gear.setMinimumHeight(0);
  android.graphics.drawable.GradientDrawable background=new android.graphics.drawable.GradientDrawable();background.setColor(Color.rgb(40,46,50));background.setCornerRadius(dp(5));background.setStroke(dp(1),Color.rgb(115,125,130));gear.setBackground(background);
  FrameLayout.LayoutParams place=new FrameLayout.LayoutParams(dp(44),dp(36),Gravity.TOP|Gravity.RIGHT);place.setMargins(0,dp(3),dp(8),0);root.addView(gear,place);gear.setOnClickListener(v->settings());
  // Honor system bars/cutouts when shown, including Android 15 edge-to-edge mode.
  root.setOnApplyWindowInsetsListener((v,insets)->{if(android.os.Build.VERSION.SDK_INT>=30){android.graphics.Insets bars=insets.getInsets(android.view.WindowInsets.Type.systemBars()|android.view.WindowInsets.Type.displayCutout());v.setPadding(bars.left,bars.top,bars.right,bars.bottom);}else v.setPadding(insets.getSystemWindowInsetLeft(),insets.getSystemWindowInsetTop(),insets.getSystemWindowInsetRight(),insets.getSystemWindowInsetBottom());return insets;});
  setContentView(root);root.requestApplyInsets();
 }
 @Override public void onWindowFocusChanged(boolean focus){super.onWindowFocusChanged(focus);if(focus)immersive();}
 private String checked(String raw){return MachineAddress.normalize(raw);}
 private boolean sameOrigin(Uri uri){Uri base=Uri.parse(address);return base.getScheme().equals(uri.getScheme())&&base.getHost().equals(uri.getHost())&&base.getPort()==uri.getPort();}
 private void open(){if(web!=null)web.destroy();web=new WebView(this);web.setBackgroundColor(Color.rgb(23,23,23));WebSettings s=web.getSettings();s.setJavaScriptEnabled(true);s.setDomStorageEnabled(true);s.setAllowFileAccess(false);s.setAllowContentAccess(false);s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);s.setTextZoom(100);web.setWebChromeClient(new WebChromeClient());
  web.setWebViewClient(new WebViewClient(){
   @Override public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest request){if(!request.isForMainFrame())return false;Uri uri=request.getUrl();if(sameOrigin(uri))return false;new AlertDialog.Builder(MainActivity.this).setTitle("Open external page?").setMessage(uri.toString()).setPositiveButton("Browser",(d,w)->{try{startActivity(new Intent(Intent.ACTION_VIEW,uri));}catch(Exception ignored){}}).setNegativeButton("Cancel",null).show();return true;}
   @Override public void onPageFinished(WebView view,String url){view.evaluateJavascript("document.documentElement.dataset.nativeApp='android';document.getElementById('pendant-fullscreen')?.style.setProperty('display','none');",null);immersive();}
   @Override public void onReceivedError(WebView view,WebResourceRequest request,WebResourceError error){if(view==web&&request.isForMainFrame())offline("Connection error "+error.getErrorCode()+": "+error.getDescription(),request.getUrl().toString());}
   @Override public void onReceivedHttpError(WebView view,WebResourceRequest request,WebResourceResponse response){if(view==web&&request.isForMainFrame())offline("HTTP "+response.getStatusCode()+" "+response.getReasonPhrase(),request.getUrl().toString());}
  });showContent(web);web.loadUrl(address+"/cnc-pendant.html");applyAppPreferences();}
 private void offline(String reason,String failedUrl){LinearLayout box=new LinearLayout(this);box.setOrientation(LinearLayout.VERTICAL);box.setPadding(dp(20),dp(60),dp(20),dp(20));box.setBackgroundColor(Color.rgb(23,23,23));TextView label=new TextView(this);label.setText("CNC Pendant — disconnected\n\nSaved machine: "+address+"\n\n"+reason+"\n\nPage: "+failedUrl+"\n\nCheck the same page in Brave on this phone. No machine commands were sent.");label.setTextColor(Color.WHITE);label.setTextSize(20);box.addView(label);Button retry=new Button(this);retry.setText("Reconnect");retry.setOnClickListener(v->open());box.addView(retry);Button configure=new Button(this);configure.setText("Machine address");configure.setOnClickListener(v->settings());box.addView(configure);showContent(box);}
 private void settings(){
  LinearLayout form=new LinearLayout(this);form.setOrientation(LinearLayout.VERTICAL);form.setPadding(dp(20),dp(4),dp(20),dp(4));
  CheckBox awake=new CheckBox(this);awake.setText("Keep screen on while app is open");awake.setChecked(preferences.getBoolean("keep_screen_on",true));form.addView(awake);
  CheckBox full=new CheckBox(this);full.setText("Full screen");full.setChecked(preferences.getBoolean("full_screen",true));form.addView(full);
  TextView label=new TextView(this);label.setText("Pi / machine address");label.setPadding(0,dp(12),0,0);form.addView(label);
  EditText input=new EditText(this);input.setSingleLine(true);input.setSaveEnabled(false);input.setImportantForAutofill(View.IMPORTANT_FOR_AUTOFILL_NO);input.setText(address.isEmpty()?"http://192.168.1.158":address);input.setInputType(android.text.InputType.TYPE_CLASS_TEXT|android.text.InputType.TYPE_TEXT_VARIATION_URI);form.addView(input);
  TextView note=new TextView(this);note.setText("These settings apply only to this Android app. CNC controls and shared preferences load from the Pi.");note.setTextSize(12);note.setPadding(0,dp(8),0,0);form.addView(note);
  AlertDialog dialog=new AlertDialog.Builder(this).setTitle("CNC Pendant 0.3 — App settings").setView(form).setPositiveButton("Save & connect",null).setNeutralButton("Reconnect",(d,w)->{if(!address.isEmpty())open();else settings();}).setNegativeButton("Cancel",(d,w)->{if(web==null)finish();}).create();
  dialog.setOnShowListener(d->dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v->{try{String next=checked(input.getText().toString());boolean saved=preferences.edit().putString("address",next).putBoolean("keep_screen_on",awake.isChecked()).putBoolean("full_screen",full.isChecked()).commit();if(!saved||!next.equals(preferences.getString("address","")))throw new IllegalStateException("Could not save the address. Please try again.");address=next;dialog.dismiss();applyAppPreferences();open();}catch(Exception e){input.setError(e.getMessage());}}));dialog.show();
 }
 @Override public void onBackPressed(){new AlertDialog.Builder(this).setTitle("CNC Pendant").setItems(new String[]{"Return to controls","Reconnect","Machine address","Exit app"},(d,which)->{if(which==1)open();if(which==2)settings();if(which==3)finish();}).show();}
 @Override protected void onNewIntent(Intent intent){super.onNewIntent(intent);handleIntent(intent);}
 private void handleIntent(Intent intent){Uri data=intent.getData();if(data==null||!"cncpendant".equals(data.getScheme()))return;String raw=data.getQueryParameter("url");if(raw==null)return;try{String proposed=checked(raw);new AlertDialog.Builder(this).setTitle("Open this CNC machine?").setMessage(proposed).setPositiveButton("Open",(d,w)->{address=proposed;preferences.edit().putString("address",address).commit();open();}).setNegativeButton("Cancel",null).show();}catch(Exception ignored){}}
 @Override protected void onDestroy(){if(web!=null)web.destroy();super.onDestroy();}
}
