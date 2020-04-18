# alexa-polly-background-mixing-nodejs
Polly Voice mixing with background music for nodejs ASK-SDK v2

This project is based on npm project lambda-audio: npmjs.com/package/lambda-audio and uses SoX (Sound eXchange) command line tool in an AWS Lambda compiled version.

But I had to edit the npm lambda-audio package at two locations. See below #6! This is important!

It allows you to generate Amazon Polly Voices in different languages mixed with background music / sounds. 

This can be used in any Amazon Alexa skill that is written in node.js / ASK-SDK v2. Can probably be ported to Jovo Framework or other frameworks as well. Feel free to do so, but please link to this project for reference!

# Set things up
1. Create a new skill in the Alexa Developer Console

-> https://developer.amazon.com/alexa/console/ask

2. Create a new Lambda Function. Make sure lambda function has execution / access rights for Polly, S3, (basic: DynamoDB for Persistant Storage, Cloudwatch for log files) (*see screenshot #1*)

-> https://eu-west-1.console.aws.amazon.com/lambda/home?region=eu-west-1#/functions

-> create a role here: https://console.aws.amazon.com/iam/home?#/roles make sure to add AmazonS3FullAccess and AmazonPollyFullAccess!

3. Lambda Function Timeout set to 30 seconds as in some edge cases it might take longer than default 3 seconds to generate polly and mix with background (*see screenshot #2*) and also add a new enviornment variable "LD_LIBRARY_PATH" with value "/var/task/node_modules/lambda-audio/lib64:$LD_PRIMARY_PATH". This is new (April 18th 2020) and needed for node.js > 10 (*see screenshot #3*)

4. Put your background music in lambda/function/audio folder. It has to be the same format as polly, so 48kb/s 22050 hz. Use "Lame XP" or other tools like ffmpeg

5. node-module required lambda-audio (I edited /lib/lambda-audio.js in line 15 and 36 to use binary from /tmp/ folder and not /bin/ folder because /bin/ folder has not execution rights, tmp folder does have +x)

6. As of April 18th 2020 and node.js > 10 you'll also need to add a file called "libgomp.so.1" into the "node_modules/lambda_audio/lib64" folder. If this folder doesn't exist, create it.

7. Pull this PoC Skill and try it out! Code is documented. I know it's not perfect, but I think everyone will understand it. If not, always feel free to get in touch: daniel@digivoice.io or https://twitter.com/DanMittendorf

8. You could also use ask-cli to deploy this code pretty easy. ;-)

# Screenshots for reference
<img width="400" alt="setup #1 permissions" src="https://digivoice.io/wp-content/uploads/2019/04/setup-things.jpg"/>
<img width="400" alt="setup #2 timeout" src="https://digivoice.io/wp-content/uploads/2019/04/setup-things_2.jpg"/>
<img width="400" alt="setup #3 environment variables" src="https://digivoice.io/wp-content/uploads/2020/04/environment-variables.png"/>

