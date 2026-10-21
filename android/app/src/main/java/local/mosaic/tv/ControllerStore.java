package local.mosaic.tv;
import android.content.Context;
import android.security.keystore.*;
import android.util.Base64;
import java.security.KeyStore;
import javax.crypto.*;
import javax.crypto.spec.GCMParameterSpec;
/** Both server and controller credential are encrypted together using a non-exportable key. */
final class ControllerStore {
 private final Context context;
 ControllerStore(Context context){this.context=context;}
 private javax.crypto.SecretKey key()throws Exception{
  KeyStore store=KeyStore.getInstance("AndroidKeyStore");store.load(null);
  if(!store.containsAlias("mosaic.controller")){
   KeyGenerator generator=KeyGenerator.getInstance("AES","AndroidKeyStore");
   generator.init(new KeyGenParameterSpec.Builder("mosaic.controller",KeyProperties.PURPOSE_ENCRYPT|KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());generator.generateKey();
  }
  return (javax.crypto.SecretKey)store.getKey("mosaic.controller",null);
 }
 void save(String server,String token)throws Exception{
  Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,key());
  String data=new org.json.JSONArray().put(server).put(token).toString();
  if(!context.getSharedPreferences("controller",0).edit().putString("iv",Base64.encodeToString(cipher.getIV(),Base64.NO_WRAP)).putString("data",Base64.encodeToString(cipher.doFinal(data.getBytes(java.nio.charset.StandardCharsets.UTF_8)),Base64.NO_WRAP)).commit())throw new java.io.IOException("Storage failed");
 }
 String[] load()throws Exception{
  android.content.SharedPreferences prefs=context.getSharedPreferences("controller",0);
  if(!prefs.contains("data"))return new String[]{"",""};
  Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.DECRYPT_MODE,key(),new GCMParameterSpec(128,Base64.decode(prefs.getString("iv",""),Base64.NO_WRAP)));
  org.json.JSONArray data=new org.json.JSONArray(new String(cipher.doFinal(Base64.decode(prefs.getString("data",""),Base64.NO_WRAP)),java.nio.charset.StandardCharsets.UTF_8));return new String[]{data.getString(0),data.getString(1)};
 }
}
