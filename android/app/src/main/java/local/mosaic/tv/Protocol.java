package local.mosaic.tv;

import java.net.URI;
import java.util.*;
import org.json.*;

public final class Protocol {
  private Protocol() {}

  public static String serverAddress(String text) {
    try {
      String value = text.trim();
      boolean bare = !value.contains("://");
      URI uri = new URI(bare ? "http://" + value : value);
      if (!Arrays.asList("http", "https").contains(uri.getScheme())
          || uri.getHost() == null
          || uri.getUserInfo() != null
          || uri.getQuery() != null
          || uri.getFragment() != null
          || !(uri.getPath().isEmpty() || uri.getPath().equals("/"))
          || uri.getPort() > 65535
          || uri.getPort() == 0) throw new Exception();
      return new URI(
              uri.getScheme(),
              null,
              uri.getHost(),
              bare && uri.getPort() < 0 ? 3210 : uri.getPort(),
              null,
              null,
              null)
          .toString();
    } catch (Exception e) {
      throw new IllegalArgumentException("请输入服务器地址，例如 10.20.30.20:3210");
    }
  }

  public static List<String> subnet(String ip, int prefix) {
    List<String> result = new ArrayList<>();
    try {
      String[] parts = ip.split("\\.");
      if (parts.length != 4 || prefix < 0 || prefix > 30) return result;
      long n = 0;
      for (String part : parts) {
        int v = Integer.parseInt(part);
        if (v < 0 || v > 255) return result;
        n = (n << 8) | v;
      }
      long first = n >>> 24, second = (n >>> 16) & 255;
      if (!(first == 10
          || first == 172 && second >= 16 && second <= 31
          || first == 192 && second == 168)) return result;
      int bounded = Math.max(prefix, 24);
      long mask = (0xffffffffL << (32 - bounded)) & 0xffffffffL,
          network = n & mask,
          end = network | (~mask & 0xffffffffL);
      for (long a = network + 1; a < end; a++)
        if (a != n)
          result.add(
              (a >>> 24) + "." + ((a >>> 16) & 255) + "." + ((a >>> 8) & 255) + "." + (a & 255));
    } catch (Exception ignored) {
    }
    return result;
  }

  public static JSONObject object(String value) throws JSONException {
    return new JSONObject(value);
  }

  public static JSONObject screen(JSONObject state, String id) throws JSONException {
    JSONArray screens = state.getJSONObject("layout").getJSONArray("screens");
    for (int i = 0; i < screens.length(); i++)
      if (id.equals(screens.getJSONObject(i).getString("id"))) return screens.getJSONObject(i);
    throw new JSONException("该屏幕已被后台删除，请重新选屏");
  }

  public static JSONObject media(JSONObject state, String id) throws JSONException {
    JSONArray list = state.getJSONArray("media");
    for (int i = 0; i < list.length(); i++)
      if (id.equals(list.getJSONObject(i).getString("id"))) return list.getJSONObject(i);
    throw new JSONException("素材不存在");
  }

  public static JSONObject validateState(JSONObject state, String screenId) throws JSONException {
    JSONObject layout = state.getJSONObject("layout"), screen = screen(state, screenId);
    int cols = layout.getInt("cols"), rows = layout.getInt("rows");
    if (cols < 1
        || cols > 16
        || rows < 1
        || rows > 16
        || layout.getInt("tileWidth") < 1
        || layout.getInt("tileHeight") < 1
        || layout.optInt("gapX") < 0
        || layout.optInt("gapY") < 0
        || screen.getInt("col") < 0
        || screen.getInt("col") >= cols
        || screen.getInt("row") < 0
        || screen.getInt("row") >= rows) throw new JSONException("无效屏幕布局");
    state.getJSONObject("playback");
    state.getJSONArray("media");
    return state;
  }

  public static JSONObject message(String type) {
    JSONObject o = new JSONObject();
    put(o, "type", type);
    return o;
  }

  public static JSONObject put(JSONObject o, String key, Object value) {
    try {
      o.put(key, value);
    } catch (JSONException e) {
      throw new IllegalArgumentException(e);
    }
    return o;
  }
}
