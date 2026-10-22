package org.mainsailcnc.pendant;
import java.net.URI;
import java.util.Locale;
/** Store only an origin. Accept a bare host or a pasted pendant URL. */
public final class MachineAddress {
 private MachineAddress(){}
 public static String normalize(String raw){
  try{
   String text=raw.trim();if(text.isEmpty())throw new IllegalArgumentException();
   if(!text.contains("://"))text="http://"+text;
   URI uri=new URI(text);String scheme=uri.getScheme().toLowerCase(Locale.ROOT),host=uri.getHost();int port=uri.getPort();
   if((!scheme.equals("http")&&!scheme.equals("https"))||host==null||uri.getUserInfo()!=null||port==0||port>65535)throw new IllegalArgumentException();
   return new URI(scheme,null,host.toLowerCase(Locale.ROOT),port,null,null,null).toASCIIString();
  }catch(Exception error){throw new IllegalArgumentException("Enter a Pi address such as http://192.168.1.158");}
 }
}
