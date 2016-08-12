'use strict'


const _fs = require('fs');
const _aws = require('aws-sdk');
const _ = require('underscore.deferred');
const _spawn = require('child_process').spawn;

//console.log("argv: " + JSON.stringify(process.argv));
if(process.argv.length >= 2)
{
    if(process.argv.length == 2)
    {
        displayHelp();
    }
    else
    {
        switch(process.argv[2].toLowerCase())
        {
            case "-h":
                displayHelp();
                break;

            case "-p":
                if(process.argv.length >= 4)
                {
                    var publishConfigPath = process.argv[3];
                    publish(publishConfigPath);
                }
                else
                {
                    displayHelp();
                }
                break;

            case "-c":
                var templateName = (process.argv.length >= 4) ? process.argv[3] : "project";
                createProjectConfigTemplate(templateName);
                break;

            default:
                displayHelp();
                break;
        }
    }
}



function displayHelp()
{
    console.log("AWS Lambda Publisher");
    console.log("--------------------");
    console.log("  -h                Displays command arguments");
    console.log("  -p <path>         Publish the project using configuration at the given path.");
    console.log("  -c [<name>]       Create a project configuration template file.");
}



function createProjectConfigTemplate(name)
{
    var config = {
        "projectName" : "",
        "projectPath" : "<full path to project source files>",
        "projectArchiveDest" : "<location to store the archive file>",
        "amazon" : {
            "accessKeyId" : "",
            "secretAccessKey" : "",
            "region" : "",
            "lamdbaName" : ""
        },
        "tests" : [
            {
                "key" : "ping1",
                "payload" : {
                    "object": "ping"
                }
            },
            {
                "key" : "ping2",
                "payload" : {
                    "object": "ping"
                }
            }
        ]
    }

    _fs.writeFileSync(name + ".config", JSON.stringify(config));
}



function publish(publishConfigPath)
{
    //TODO: Validate the file exists
    //TODO: Validate the parameters in the file
    var config = JSON.parse(_fs.readFileSync(publishConfigPath));
    var archiveFilePath = config.projectArchiveDest + config.projectName + '.zip';

    //Step 1
    console.log("Starting publish process for " + config.amazon.lamdbaName);
    removeOldArchive(archiveFilePath).then(function(code)
    {
        //console.log("code: " + code);
        if(code != undefined && (code == 0 || code == 1))
        {
            //Step 2
            zipArchive(config.projectPath, archiveFilePath).then(function(code)
            {
                console.log("archive completed...");

                if(code != undefined && code == 0)
                {
                    //Step 3
                    publishToAwsLambda(config.amazon, config.amazon.lamdbaName, archiveFilePath).then(function(code)
                    {
                        if(code == 0)
                        {
                            if(config.tests && config.tests.length > 0)
                            {
                                console.log("Testing...");

                                postPublishLambdaTest(config.amazon, config.amazon.lamdbaName, config.tests[0]).then(function(code)
                                {
                                    console.log("finished...");
                                });
                            }
                        }
                    });
                }
                else
                {
                    console.log("ERROR: Unable to create archive file.");
                }
            });
        }
    });
}



function removeOldArchive(archiveFilePath)
{
    var dfd = new _.Deferred();

    //TODO: First check to see if the archive exists, and only call rm if it does.
    const rmArchiveFile = _spawn('rm', [archiveFilePath]);
    rmArchiveFile.on('close', (code) => {
        //console.log("rm completed - " + code);
        dfd.resolve(code);
    });

    return dfd.promise();
}



function zipArchive(projectPath, archiveFilePath)
{
    var dfd = new _.Deferred();
    const zip = _spawn('ditto', ['-c', '-k', projectPath, archiveFilePath]);
    zip.on('close', (code) => {
        dfd.resolve(code);
    });
    return dfd.promise();
}



function publishToAwsLambda(awsConfig, lambdaName, archiveFilePath)
{
    var dfd = new _.Deferred();


    console.log("Publishing code to " + lambdaName);


    var lambdaConfig =
    {
            "accessKeyId" : awsConfig.accessKeyId,
            "secretAccessKey" : awsConfig.secretAccessKey,
            "region" : awsConfig.region
    };

    _aws.config.update(lambdaConfig);
//console.log("config: " + JSON.stringify(lambdaConfig));

    var lambda = new _aws.Lambda();
    var params = {
      FunctionName: lambdaName,
      Publish: true,
      ZipFile: _fs.readFileSync(archiveFilePath)
    };

    lambda.updateFunctionCode(params, function(err, data)
    {
        if (err) console.log(err, err.stack); // an error occurred
        else     console.log(data);           // successful response

        dfd.resolve((err) ? -1 : 0);
    });

    return dfd.promise();
}



function postPublishLambdaTest(awsConfig, lambdaName, test)
{
    var dfd = new _.Deferred();

    var lambdaConfig =
    {
            "accessKeyId" : awsConfig.accessKeyId,
            "secretAccessKey" : awsConfig.secretAccessKey,
            "region" : awsConfig.region
    };

    _aws.config.update(lambdaConfig);
    var lambda = new _aws.Lambda();

    console.log("Running test: " + test.key);

    var params = {
      FunctionName: lambdaName,
      InvocationType: 'Event',
      LogType: 'Tail',
      Payload: JSON.stringify(test.payload)
    };

    lambda.invoke(params, function(err, data) {
      if (err) console.log(err, err.stack); // an error occurred
      else     console.log(data);           // successful response
      dfd.resolve((err) ? -1 : 0);
    });

    return dfd.promise();
}
