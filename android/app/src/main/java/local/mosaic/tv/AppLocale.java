package local.mosaic.tv;
import android.content.Context;
import android.content.res.Configuration;
import java.util.Locale;
final class AppLocale {
 static Context wrap(Context base){String language=base.getSharedPreferences("language",0).getString("locale","zh");Configuration config=new Configuration(base.getResources().getConfiguration());config.setLocale(Locale.forLanguageTag(language));return base.createConfigurationContext(config);}
 static void set(Context context,String language){context.getSharedPreferences("language",0).edit().putString("locale",language).apply();}
}
