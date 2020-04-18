/* eslint no-use-before-define: 0 */
// sets up dependencies
process.env['PATH'] = process.env['PATH'] + ':' + process.env['LAMBDA_TASK_ROOT'] // required for lambda-audio
'use strict';
const Alexa = require('ask-sdk');
const aws = require('aws-sdk'); //for s3 saving
const lambdaAudio = require('lambda-audio'); //magic
const mp3Duration = require('mp3-duration'); //to calculate polly audio length
const fs = require('fs-extra'); //required for local file write and read
const crypto = require('crypto'); //for md5 hashing ssml string to generate a checksume filename for caching

// settings
let myRegion = 'eu-west-1' // edit for your desired region (only eu-west-1 and us-west-1 support neural TTS voices) Joanna and Matthew
const myBucket = ''; //bucket-name for uploading


//make sure the audio has the same format as polly voice so, 48 kb/s and 22.050 hz mp3 make sure to not make it too loud, otherwise the polly voice cannot be understood
const background_sfx = './audio/whales_low_volume.mp3'; 

//initialize polly and s3
const s3 = new aws.S3();
const polly = new aws.Polly({
    signatureVersion: 'v4',
    region: myRegion
});

//functions
async function copyFiles () {
  try {
    await fs.copy('./node_modules/lambda-audio/bin/sox', '/tmp/sox')
    await fs.copy('./node_modules/lambda-audio/bin/lame', '/tmp/lame')
    await fs.chmod('/tmp/sox', '777');
    await fs.chmod('/tmp/lame', '777')
    console.log('success copying and executing sox lame rights!')
  } catch (err) {
    console.error(err)
  }
}

const generatePollyAudio = (text, voiceId) => {
  // Generate audio from Polly and check if output is a Buffer
    let params;      
    //neural when using neural voices Joanna or Matthew, in all other cases use 'standard'
    if (voiceId === "Joanna" || voiceId === "Matthew") {
        params = {
          Engine: 'neural', 
          Text: text,
          SampleRate: '22050',
          OutputFormat: 'mp3',
          TextType: 'ssml',
          VoiceId: voiceId // see Polly API for the list http://docs.aws.amazon.com/fr_fr/polly/latest/dg/API_Voice.html#API_Voice_Contents
         }
    }
    else {
        params = {
          Engine: 'standard',
          Text: text,
          OutputFormat: 'mp3',
          TextType: 'ssml',
          VoiceId: voiceId // see Polly API for the list http://docs.aws.amazon.com/fr_fr/polly/latest/dg/API_Voice.html#API_Voice_Contents
         }
    }
        
      
          return polly.synthesizeSpeech(params).promise().then( audio => {
          if (audio.AudioStream instanceof Buffer) return audio
          else throw 'AudioStream is not a Buffer.'
          })
};

const writeAudioStreamToS3Bucket = ( audioStream, filename ) =>
    putObject(myBucket, filename, audioStream, 'audio/mp3').then( res => {
    if(!res.ETag) throw res
    else {
        //previously
        return {
            msg: 'File successfully generated.',
            ETag: res.ETag,
            url: `https://s3-${myRegion}.amazonaws.com/${myBucket}/${filename}`
            }
       
}
});

const putObject = (myBucket, key, body, contentType) =>
    s3.putObject({
        Bucket: myBucket,
        Key: key,
        Body: body,
        ContentType: contentType
}).promise();

/** 
 * lambdaAudio.sox -m / merges the files and compresses them with 
 * @48 kb/s and a rate of 22050 + increased volume "gain -l 16" 
 * because merging with sox decreased volume to avoid clipping. 
 * last but not least, trim the resulting file so it is only as long as polly voice 
 * get more info about using command line tool sox @ http://sox.sourceforge.net/Docs/FAQ
**/
const mix_polly_with_background = (background_mp3, polly_voice_mp3, resulting_mp3, duration) => 
lambdaAudio.sox ('-m '+background_mp3+' '+polly_voice_mp3+' -C 48.01 '+resulting_mp3+' rate 22050 gain -l 16 trim 0 '+duration).then(() => {
        return resulting_mp3
}).catch(err => console.error("mix error: "+err));

/** This is where the magic happens
 * ssml: <speak>Text</speak>
 * voice: name of polly voice: https://docs.aws.amazon.com/de_de/polly/latest/dg/voicelist.html)
 * background_sound: see background_sfx! define audio files stored locally in your lambda "audio" folder @ 48kb/s / 22.050 Hz
 * polly_voice: temporary polly voice filename for saving in lambda /tmp/
 * sound_mix_result: filename for resulting mix of ssml+voice+background, will be saved in s3 bucket! see settings!
 **/
async function generatePollyUrl (ssml, voice, background_sound) {
  let sound_mix_result = crypto.createHash('md5').update(ssml+voice+background_sound).digest('hex')+".mp3"; //create a standard filename based on ssml voice and background music  greate a universal md5 hash for shorter filename
  console.log("sound mix result filename: "+sound_mix_result);

  try { // first: checking if file exists, if not, do the magic
    await s3.headObject({Bucket: myBucket,Key: sound_mix_result}).promise();
    console.log("requested file exists in your s3 bucket. returning the url to the audio tag now.")
    return '<audio src="https://s3-'+myRegion+'.amazonaws.com/'+myBucket+'/'+sound_mix_result+'"/>';;
  } catch (err) { // error case: file does not exist.
      console.log("File does not exist. So generating it now." + err);
      let polly_voice = "polly_tmp_"+Math.round(+new Date() / 10)+".mp3"; //generate a temp filename for polly mp3. will be purged in /tmp/ soon
      console.log("polly voice filename: "+polly_voice);
      if (fs.existsSync('/tmp/sox') && fs.existsSync('/tmp/lame')) { console.log('Found lame and sox file'); }
      else { await copyFiles(); }//has to invoke this function in order to copy sox / lame to /tmp/ to be able to execute them later. this has to happen every time because the tmp folder get purged every few minutes - todo: implement check if files exist and have the correct permissions +x
      const pollyVoice = await generatePollyAudio(ssml, voice); 
      await fs.outputFile('/tmp/'+polly_voice, pollyVoice.AudioStream); //writes pollyAudioStream to writeable /tmp/ folder
      
      //use this for mixing background with polly voices
      const duration = await mp3Duration('/tmp/'+polly_voice); //calculate length of polly voice. this is important for mixing result because mixing of 5 seconds polly with 10 seconds background will result in 10 seconds polly + background. but you only want the background sfx to be as long as the polly voice
      var file = await mix_polly_with_background (background_sound, '/tmp/'+polly_voice, '/tmp/'+sound_mix_result, duration); //mixes background with polly and saves to tmp folder, limited by duration of polly voice
      const uploadFile = await fs.readFile(file); //remove the // in front of the line to enable mixing polly with background then make sure to comment out the next line
      
      //use this for neural voice only
      //const uploadFile = await fs.readFile('/tmp/'+polly_voice); //read the file
      //end

      var writeToS3 = await writeAudioStreamToS3Bucket(uploadFile, sound_mix_result); 
      console.log(writeToS3.url);
    return '<audio src="'+writeToS3.url+'"/>';
  }
}
/**
 * The End*/


// core functionality for the skill
const LaunchHandler = {
  canHandle(handlerInput) {
    const request = handlerInput.requestEnvelope.request;
    console.log("LaunchHandler: canHandle ");
    return request.type === 'LaunchRequest';

  },
  async handle(handlerInput) { //important make it ASYNC
    console.log("LaunchHandler: isHandling ");
    
	//New Polly with Newscaster Style
    //let pollyVoice = await generatePollyUrl("<speak>Another test with Polly voice of Joanna. So this is my new normal neural voice. Sounds great doesn't it? Not wait for my newscaster voice. Three, two, one. Here it comes.  <amazon:domain name='news'>Hi! This is my newscaster voice! I can even read your desired text in newscaster style! Do you notice the difference? Isn't this awesome? I know a lot of great news, but I will keep this to myself for another time.</amazon:domain> Do you like my female voice? I certainly do like my fantastic voice! </speak>", "Joanna", background_sfx);
	//let easySpeakOutput = 'And here comes Joannas neural polly voice: '+ pollyVoice +' Wow, that is so cool! ';
	
	//Old Polly Voice
	let pollyVoiceWithBackground = await generatePollyUrl("<speak>Another test with Polly voice Brian. Do you like my male voice? I certainly do like my fantastic voice! It's even greater with ocean waves in the background!</speak>", "Brian", background_sfx);
    let easySpeakOutput = 'And here comes Brians polly voice with background sounds: '+ pollyVoiceWithBackground +' Wow, that is so cool! ';
 
	
    
 
    
    return handlerInput.responseBuilder
      .speak(easySpeakOutput)
      .getResponse();
  
  },
};
const ExitHandler = {
    canHandle(handlerInput) {
      const request = handlerInput.requestEnvelope.request;
      return request.type === 'IntentRequest'
        && (request.intent.name === 'AMAZON.CancelIntent'
          || request.intent.name === 'AMAZON.StopIntent' || request.intent.name === 'AMAZON.PauseIntent' || request.intent.name === 'AMAZON.NoIntent');
    },
    handle(handlerInput) {
      return handlerInput.responseBuilder
        .speak("See you next time!")
        .getResponse();
    },
};
const HelpHandler = {
    canHandle(handlerInput) {
      const request = handlerInput.requestEnvelope.request;
      return request.type === 'IntentRequest'
        && request.intent.name === 'AMAZON.HelpIntent';
    },
    handle(handlerInput) {
      return handlerInput.responseBuilder
        .speak(requestAttributes.t('HELP_MESSAGE'))
        .reprompt(requestAttributes.t('HELP_REPROMPT'))
        .getResponse();
    },
};
const FallbackHandler = {
    // 2018-Aug-01: AMAZON.FallbackIntent is only currently available in en-* locales.
    //              This handler will not be triggered except in those locales, so it can be
    //              safely deployed for any locale.
    canHandle(handlerInput) {
      const request = handlerInput.requestEnvelope.request;
      return request.type === 'IntentRequest'
        && request.intent.name === 'AMAZON.FallbackIntent';
    },
    handle(handlerInput) {
      return handlerInput.responseBuilder
        .speak(requestAttributes.t('FALLBACK_MESSAGE'))
        .reprompt(requestAttributes.t('FALLBACK_REPROMPT'))
        .getResponse();
    },
};
const SessionEndedRequestHandler = {
  canHandle(handlerInput) {
    const request = handlerInput.requestEnvelope.request;
    return request.type === 'SessionEndedRequest';
  },
  handle(handlerInput) {
    console.log(`Session ended with reason: ${handlerInput.requestEnvelope.request.reason}`);
    return handlerInput.responseBuilder.getResponse();
  },
};
const ErrorHandler = {
  canHandle() {
    return true;
  },
  handle(handlerInput, error) {
    console.log(`Error handled: ${error.message}`);
    console.log(`Error stack: ${error.stack}`);
    const requestAttributes = handlerInput.attributesManager.getRequestAttributes();
    return handlerInput.responseBuilder
      .speak(requestAttributes.t('ERROR_MESSAGE'))
      .getResponse();
  },
};


exports.handler = function (event, context) {
    let PoCSkill = Alexa.SkillBuilders.standard()
    .addRequestHandlers(
        LaunchHandler,
        HelpHandler,
        ExitHandler,
        FallbackHandler,
        SessionEndedRequestHandler,
    )
    .addErrorHandlers(ErrorHandler);

  let skill = PoCSkill.create();
  return skill.invoke(event, context);
  }
