package local.mosaic.tv;

import android.content.*;
import android.security.keystore.*;
import android.util.Base64;
import java.security.KeyStore;
import javax.crypto.*;
import javax.crypto.spec.GCMParameterSpec;
import org.json.JSONObject;

final class PairingStore {
  private final android.content.SharedPreferences prefs;

  PairingStore(Context c) {
    prefs = c.getSharedPreferences("pairing", Context.MODE_PRIVATE);
  }

  private javax.crypto.SecretKey key() throws Exception {
    KeyStore store = KeyStore.getInstance("AndroidKeyStore");
    store.load(null);
    String alias = "mosaic-tv-pairing";
    if (!store.containsAlias(alias)) {
      KeyGenerator generator =
          KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
      generator.init(
          new KeyGenParameterSpec.Builder(
                  alias, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
              .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
              .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
              .build());
      generator.generateKey();
    }
    return (javax.crypto.SecretKey) store.getKey(alias, null);
  }

  void save(String base, String screen, String token) throws Exception {
    JSONObject value = new JSONObject();
    value.put("base", base);
    value.put("screen", screen);
    value.put("key", token);
    Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
    cipher.init(Cipher.ENCRYPT_MODE, key());
    prefs
        .edit()
        .putString("iv", Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP))
        .putString(
            "secret",
            Base64.encodeToString(
                cipher.doFinal(value.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8)),
                Base64.NO_WRAP))
        .putString("server", base)
        .apply();
  }

  JSONObject load() {
    try {
      String value = prefs.getString("secret", null);
      if (value == null) return null;
      Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
      cipher.init(
          Cipher.DECRYPT_MODE,
          key(),
          new GCMParameterSpec(128, Base64.decode(prefs.getString("iv", ""), Base64.NO_WRAP)));
      return new JSONObject(
          new String(
              cipher.doFinal(Base64.decode(value, Base64.NO_WRAP)),
              java.nio.charset.StandardCharsets.UTF_8));
    } catch (Exception e) {
      clear();
      return null;
    }
  }

  String server() {
    return prefs.getString("server", BuildConfig.DEFAULT_SERVER);
  }

  void remember(String base) {
    prefs.edit().putString("server", base).apply();
  }

  void clear() {
    prefs.edit().remove("iv").remove("secret").apply();
  }
}
