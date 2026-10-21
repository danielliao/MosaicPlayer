package local.mosaic.tv;
import android.app.*;
import android.content.*;
import android.os.Bundle;
import android.speech.RecognizerIntent;
import android.text.InputType;
import android.view.*;
import android.widget.*;
import org.json.*;
import java.util.*;
import java.util.concurrent.*;
/** Foreground-only controller. Speech only edits a draft; every command requires a dialog. */
public final class ControllerActivity extends Activity {
 private final ExecutorService worker=Executors.newSingleThreadExecutor();
 private final Map<String,String> media=new LinkedHashMap<>();
 private final List<String> groupIds=new ArrayList<>();
 private EditText server,key,transcript; private Spinner groups;private TextView status;private ControllerApi api;private boolean busy;
 @Override protected void attachBaseContext(Context base){super.attachBaseContext(AppLocale.wrap(base));}
 @Override public void onCreate(Bundle state){super.onCreate(state);getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
  ScrollView scroll=new ScrollView(this);LinearLayout layout=new LinearLayout(this);layout.setOrientation(LinearLayout.VERTICAL);layout.setPadding(24,24,24,24);scroll.addView(layout);setContentView(scroll);
  TextView title=new TextView(this);title.setText(R.string.controller);title.setTextSize(24);layout.addView(title);
  button(layout,R.string.language,()->new AlertDialog.Builder(this).setItems(new String[]{"中文","English"},(dialog,which)->{AppLocale.set(this,which==0?"zh":"en");recreate();}).show());
  server=input(layout,R.string.server,InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_VARIATION_URI);key=input(layout,R.string.api_key,InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_VARIATION_PASSWORD);key.setSaveEnabled(false);
  try{String[] saved=new ControllerStore(this).load();server.setText(saved[0]);key.setText(saved[1]);}catch(Exception ignored){/* Never expose credential or crypto errors. */}
  android.text.TextWatcher invalidate=new android.text.TextWatcher(){public void beforeTextChanged(CharSequence s,int start,int count,int after){}public void onTextChanged(CharSequence s,int start,int before,int count){api=null;}public void afterTextChanged(android.text.Editable s){}};
  server.addTextChangedListener(invalidate);key.addTextChangedListener(invalidate);
  button(layout,R.string.load_groups,()->load());groups=new Spinner(this);layout.addView(groups);
  transcript=input(layout,R.string.transcript,InputType.TYPE_CLASS_TEXT);button(layout,R.string.speak,()->speak());button(layout,R.string.review,()->review(transcript.getText().toString()));
  button(layout,R.string.pause,()->review("pause"));button(layout,R.string.resume,()->review("resume"));
  status=new TextView(this);layout.addView(status);button(layout,R.string.back,()->finish());
 }
 private EditText input(LinearLayout layout,int hint,int type){EditText value=new EditText(this);value.setHint(hint);value.setInputType(type);value.setSingleLine(true);layout.addView(value);return value;}
 private void button(LinearLayout layout,int label,Runnable action){Button value=new Button(this);value.setText(label);value.setOnClickListener(v->action.run());layout.addView(value);}
 private void load(){if(busy)return;busy=true;api=null;groupIds.clear();media.clear();groups.setAdapter(new ArrayAdapter<String>(this,android.R.layout.simple_spinner_dropdown_item,new ArrayList<>()));
  final String host=server.getText().toString().trim(),token=key.getText().toString().trim();status.setText(R.string.loading);
  worker.execute(()->{try{ControllerApi candidate=new ControllerApi(host,token);JSONArray result=candidate.list("groups"),assets=candidate.list("media");new ControllerStore(this).save(host,token);
   runOnUiThread(()->{if(isDestroyed())return;if(!host.equals(server.getText().toString().trim())||!token.equals(key.getText().toString().trim())){busy=false;status.setText(R.string.failed);return;}List<String> names=new ArrayList<>();try{for(int i=0;i<result.length();i++){JSONObject group=result.getJSONObject(i);groupIds.add(group.getString("id"));names.add(group.optString("name",group.getString("id")));}StringBuilder catalog=new StringBuilder(getString(R.string.ready));for(int i=0;i<assets.length();i++){JSONObject asset=assets.getJSONObject(i);String name=asset.optString("name",asset.optString("originalName",""));media.put(asset.getString("id"),name);catalog.append("\n").append(name);}groups.setAdapter(new ArrayAdapter<>(this,android.R.layout.simple_spinner_dropdown_item,names));api=candidate;status.setText(catalog);}catch(Exception ignored){status.setText(R.string.failed);}busy=false;});
  }catch(Exception ignored){runOnUiThread(()->{busy=false;status.setText(R.string.failed);});}});
 }
 private void speak(){try{Intent intent=new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL,RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE,getSharedPreferences("language",0).getString("locale","zh"));startActivityForResult(intent,41);}catch(ActivityNotFoundException ignored){status.setText(R.string.speech_unavailable);}}
 @Override protected void onActivityResult(int request,int result,Intent data){super.onActivityResult(request,result,data);if(request==41&&result==RESULT_OK&&data!=null){ArrayList<String> values=data.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS);if(values!=null&&!values.isEmpty())transcript.setText(values.get(0));}}
 private void review(String text){if(busy)return;ControllerCommand command=ControllerCommand.parse(text,media);int position=groups.getSelectedItemPosition();String group=position>=0&&position<groupIds.size()?groupIds.get(position):null;
  if(api==null||!ControllerCommand.canConfirm(group,command)){status.setText(R.string.invalid_command);return;}
  final ControllerApi target=api;String details=groups.getSelectedItem()+"\n"+command.action+(command.mediaId==null?"":"\n"+media.get(command.mediaId));
  new AlertDialog.Builder(this).setTitle(R.string.confirm).setMessage(details).setNegativeButton(android.R.string.cancel,null).setPositiveButton(R.string.send,(dialog,which)->{if(busy)return;busy=true;status.setText(R.string.loading);worker.execute(()->{boolean ok;try{target.control(group,command);ok=true;}catch(Exception ignored){ok=false;}final boolean success=ok;runOnUiThread(()->{busy=false;if(!isDestroyed())status.setText(success?R.string.sent:R.string.failed);});});}).show();
 }
 @Override protected void onDestroy(){worker.shutdownNow();super.onDestroy();}
}
