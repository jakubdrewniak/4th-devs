Choose Gmail API scopes

This document contains Gmail API-specific authorization and authentication information. Before reading this document, be sure to read the Google Workspace's general authentication and authorization information at Learn about authentication and authorization.

Configure OAuth 2.0 for authorization
Configure the OAuth consent screen and choose scopes to define what information is displayed to users and app reviewers, and register your app so that you can publish it later.

Gmail API scopes
To define the level of access granted to your app, you need to identify and declare authorization scopes. An authorization scope is an OAuth 2.0 URI string that contains the Google Workspace app name, what kind of data it accesses, and the level of access. Scopes are your app's requests to work with Google Workspace data, including users' Google Account data.


When your app is installed, a user is asked to validate the scopes used by the app. Generally, you should choose the most narrowly focused scope possible and avoid requesting scopes that your app doesn't require. Users more readily grant access to limited, clearly described scopes.

If your public application uses scopes that permit access to certain user data, it must complete a verification process. If you see unverified app on the screen when testing your application, you must submit a verification request to remove it. Find out more about unverified apps and get answers to frequently asked questions about app verification in the Help Center.
The Gmail API supports the following scopes:

Scope code	Description	Usage
https://www.googleapis.com/auth/gmail.addons.current.action.compose	Manage drafts and send emails when you interact with the add-on.	Non-sensitive
https://www.googleapis.com/auth/gmail.addons.current.message.action	View your email messages when you interact with the add-on.	Non-sensitive
https://www.googleapis.com/auth/gmail.addons.current.message.metadata	View your email message metadata when the add-on is running.	Sensitive
https://www.googleapis.com/auth/gmail.addons.current.message.readonly	View your email messages when the add-on is running.	Sensitive
https://www.googleapis.com/auth/gmail.labels	Create, read, update, and delete labels only.	Non-sensitive
https://www.googleapis.com/auth/gmail.send	Send messages only. No read or modify privileges on mailbox.	Sensitive
https://www.googleapis.com/auth/gmail.readonly	Read all resources and their metadata—no write operations.	Restricted
https://www.googleapis.com/auth/gmail.compose	Create, read, update, and delete drafts. Send messages and drafts.	Restricted
https://www.googleapis.com/auth/gmail.insert	Insert and import messages only.	Restricted
https://www.googleapis.com/auth/gmail.modify	All read/write operations except immediate, permanent deletion of threads and messages, bypassing Trash.	Restricted
https://www.googleapis.com/auth/gmail.metadata	Read resources metadata including labels, history records, and email message headers, but not the message body or attachments.	Restricted
https://www.googleapis.com/auth/gmail.settings.basic	Manage basic mail settings.	Restricted
https://www.googleapis.com/auth/gmail.settings.sharing	Manage sensitive mail settings, including forwarding rules and aliases.

Note:Operations guarded by this scope are restricted to administrative use only. They are only available to Google Workspace customers using a service account with domain-wide delegation.	Restricted
https://mail.google.com/	Full access to the account's mailboxes, including permanent deletion of threads and messages This scope should only be requested if your application needs to immediately and permanently delete threads and messages, bypassing Trash; all other actions can be performed with less permissive scopes.	Restricted
The Usage column in the table above indicates the sensitivity of each scope, according to the following definitions:

Non-sensitive——These scopes provide the smallest sphere of authorization access and only require basic app verification. For information about this requirement, see Steps to prepare for verification.

Sensitive—These scopes allow access to Google User Data and require a sensitive scope verification process. For information on this requirement, see Google API Services: User Data Policy. These scopes don't require a security assessment.

Restricted—These scopes provide wide access to Google User Data and require you to go through a restricted scope verification process. For information about this requirement, see Google API Services: User Data Policy and Additional Requirements for Specific API Scopes. If you store restricted scope data on servers (or transmit), then you need to go through a security assessment.

Additional information that governs your use and access to Gmail APIs when you request to access user data can be found in the Gmail API Services User Data and Developer Policy.

If your app requires access to any other Google APIs, you can add those scopes as well. For more information about Google API scopes, see Using OAuth 2.0 to Access Google APIs.

OAuth verification
Using certain sensitive OAuth scopes might require that your app go through Google's OAuth verification process. Read the OAuth verification FAQ to determine when your app should go through verification and what type of verification is required. See also the Google API Services: User Data Policy.Implement server-side authorization

Requests to the Gmail API must be authorized using OAuth 2.0 credentials. You should use server-side flow when your application needs to access Google APIs on behalf of the user, for example when the user is offline. This approach requires passing a one-time authorization code from your client to your server; this code is used to acquire an access token and refresh tokens for your server.

To learn more about server-side Google OAuth 2.0 implementation, see Using OAuth 2.0 for Web Server Applications.

Create a client ID and client secret
To get started using Gmail API, you need to first use the setup tool, which guides you through creating a project in the Google API Console and enabling the API.

From the Credentials page, click Create credentials > OAuth client ID to create your OAuth 2.0 credentials or Create credentials > Service account key to create a service account.
If you created an OAuth client ID, then select your application type.
Fill in the form and click Create.
Your application's client IDs and service account keys are now listed on the Credentials page. For details, click a client ID; parameters vary depending on the ID type, but might include email address, client secret, JavaScript origins, or redirect URIs.

Take note of the Client ID as you'll need to add it to your code later.

Handling authorization requests
When a user loads your application for the first time, they are presented with a dialog to grant permission for your application to access their Gmail account with the requested permission scopes. After this initial authorization, the user is only presented with the permission dialog if your app's client ID changes or the requested scopes have changed.

Authenticate the user
This initial sign-in returns an authorization result object that contains an authorization code if successful.

Exchange the authorization code for an access token
The authorization code is a one-time code that your server can exchange for an access token. This access token is passed to the Gmail API to grant your application access to user data for a limited time.

If your application requires offline access, the first time your app exchanges the authorization code, it also receives a refresh token that it uses to receive a new access token after a previous token has expired. Your application stores this refresh token (generally in a database on your server) for later use.

Important: Always store user refresh tokens. If your application needs a new refresh token it must send a request with the approval_prompt query parameter set to force. This will cause the user to see a dialog to grant permission to your application again.
The following code samples demonstrate exchanging an authorization code for an access token with offline access and storing the refresh token.

Python
Replace CLIENTSECRETS_LOCATION value with the location of your credentials.json file.


import logging
from oauth2client.client import flow_from_clientsecrets
from oauth2client.client import FlowExchangeError
from oauth2client.client import Credentials # Needed for type hinting/usage in comments
from googleapiclient.discovery import build
from googleapiclient import errors as google_api_errors
import httplib2

# Path to credentials.json which should contain a JSON document such as:
#   {
#     "web": {
#       "client_id": "[[YOUR_CLIENT_ID]]",
#       "client_secret": "[[YOUR_CLIENT_SECRET]]",
#       "redirect_uris": [],
#       "auth_uri": "https://accounts.google.com/o/oauth2/auth",
#       "token_uri": "https://accounts.google.com/o/oauth2/token"
#     }
#   }
CLIENTSECRETS_LOCATION = '<PATH/TO/CLIENT_SECRETS.JSON>'
REDIRECT_URI = '<YOUR_REGISTERED_REDIRECT_URI>'
SCOPES = [
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile',
    # Add other requested scopes.
]

class GetCredentialsException(Exception):
  """Error raised when an error occurred while retrieving credentials.

  Attributes:
    authorization_url: Authorization URL to redirect the user to in order to
                      request offline access.
  """
  def __init__(self, authorization_url):
    """Construct a GetCredentialsException."""
    super().__init__(f"Authorization URL: {authorization_url}")
    self.authorization_url = authorization_url

class CodeExchangeException(GetCredentialsException):
  """Error raised when a code exchange has failed."""
  pass

class NoRefreshTokenException(GetCredentialsException):
  """Error raised when no refresh token has been found."""
  pass

class NoUserIdException(Exception):
  """Error raised when no user ID could be retrieved."""
  pass

def get_stored_credentials(user_id):
  """Retrieved stored credentials for the provided user ID.

  Args:
    user_id: User's ID.

  Returns:
    Stored oauth2client.client.OAuth2Credentials if found, None otherwise.

  Raises:
    NotImplementedError: This function has not been implemented.
  """
  # TODO: Implement this function to work with your database.
  #       To instantiate an OAuth2Credentials instance from a Json
  #       representation, use the oauth2client.client.Credentials.new_from_json
  #       class method. (oauth2client.client.Credentials needs to be imported)
  #       Example:
  #       from oauth2client.client import Credentials
  #       json_creds = load_from_db(user_id)
  #       if json_creds:
  #           return Credentials.new_from_json(json_creds)
  #       return None
  raise NotImplementedError()

def store_credentials(user_id, credentials):
  """Store OAuth 2.0 credentials in the application's database.

  This function stores the provided OAuth 2.0 credentials using the user ID as
  key.

  Args:
    user_id: User's ID.
    credentials: OAuth 2.0 credentials to store.

  Raises:
    NotImplementedError: This function has not been implemented.
  """
  # TODO: Implement this function to work with your database.
  #       To retrieve a Json representation of the credentials instance, call the
  #       credentials.to_json() method.
  #       Example:
  #       save_to_db(user_id, credentials.to_json())
  raise NotImplementedError()

def exchange_code(authorization_code):
  """Exchange an authorization code for OAuth 2.0 credentials.

  Args:
    authorization_code: Authorization code to exchange for OAuth 2.0
                        credentials.

  Returns:
    oauth2client.client.OAuth2Credentials instance.

  Raises:
    CodeExchangeException: an error occurred.
  """
  flow = flow_from_clientsecrets(CLIENTSECRETS_LOCATION, ' '.join(SCOPES))
  flow.redirect_uri = REDIRECT_URI
  try:
    credentials = flow.step2_exchange(authorization_code)
    return credentials
  except FlowExchangeError as error:
    logging.error('An error occurred: %s', error)
    raise CodeExchangeException(None)

def get_user_info(credentials):
  """Send a request to the UserInfo API to retrieve the user's information.

  Args:
    credentials: oauth2client.client.OAuth2Credentials instance to authorize the
              request.

  Returns:
    User information as a dict.
  """
  user_info_service = build(
      serviceName='oauth2', version='v2',
      http=credentials.authorize(httplib2.Http()))
  user_info = None
  try:
    user_info = user_info_service.userinfo().get().execute()
  except google_api_errors.HttpError as e:
    logging.error('An error occurred: %s', e)
  if user_info and user_info.get('id'):
    return user_info
  else:
    raise NoUserIdException()

def get_authorization_url(email_address, state):
  """Retrieve the authorization URL.

  Args:
    email_address: User's e-mail address.
    state: State for the authorization URL.

  Returns:
    Authorization URL to redirect the user to.
  """
  flow = flow_from_clientsecrets(CLIENTSECRETS_LOCATION, ' '.join(SCOPES))
  flow.params['access_type'] = 'offline'
  flow.params['approval_prompt'] = 'force'
  flow.params['user_id'] = email_address
  flow.params['state'] = state
  # The step1_get_authorize_url method uses the flow.redirect_uri attribute.
  flow.redirect_uri = REDIRECT_URI
  return flow.step1_get_authorize_url()

def get_credentials(authorization_code, state):
  """Retrieve credentials using the provided authorization code.

  This function exchanges the authorization code for an access token and queries
  the UserInfo API to retrieve the user's e-mail address.

  If a refresh token has been retrieved along with an access token, it is stored
  in the application database using the user's e-mail address as key.

  If no refresh token has been retrieved, the function checks in the application
  database for one and returns it if found or raises a NoRefreshTokenException
  with the authorization URL to redirect the user to.

  Args:
    authorization_code: Authorization code to use to retrieve an access token.
    state: State to set to the authorization URL in case of error.

  Returns:
    oauth2client.client.OAuth2Credentials instance containing an access and
    refresh token.

  Raises:
    CodeExchangeError: Could not exchange the authorization code.
    NoRefreshTokenException: No refresh token could be retrieved from the
                          available sources.
  """
  email_address = ''
  try:
    credentials = exchange_code(authorization_code)
    user_info = get_user_info(credentials) # Can raise NoUserIdException or google_api_errors.HttpError
    email_address = user_info.get('email')
    user_id = user_info.get('id')
    if credentials.refresh_token is not None:
      store_credentials(user_id, credentials)
      return credentials
    else:
      credentials = get_stored_credentials(user_id)
      if credentials and credentials.refresh_token is not None:
        return credentials
  except CodeExchangeException as error:
    logging.error('An error occurred during code exchange.')
    # Drive apps should try to retrieve the user and credentials for the current
    # session.
    # If none is available, redirect the user to the authorization URL.
    error.authorization_url = get_authorization_url(email_address, state)
    raise error
  except NoUserIdException:
    logging.error('No user ID could be retrieved.')
  # No refresh token has been retrieved.
  authorization_url = get_authorization_url(email_address, state)
  raise NoRefreshTokenException(authorization_url)
Code Tutor
expand_more
Authorizing with stored credentials
When users visit your app after a successful first-time authorization flow, your application can use a stored refresh token to authorize requests without prompting the user again.

If you have already authenticated the user, your application can retrieve the refresh token from its database and store the token in a server-side session. If the refresh token is revoked or is otherwise invalid, you'll need to catch this and take appropriate action.

Using OAuth 2.0 credentials
Once OAuth 2.0 credentials have been retrieved as shown in the previous section, they can be used to authorize a Gmail service object and send requests to the API.

Instantiate a service object
This code sample shows how to instantiate a service object and then authorize it to make API requests.

Python

from apiclient.discovery import build
# ...

def build_service(credentials):
  """Build a Gmail service object.

  Args:
    credentials: OAuth 2.0 credentials.

  Returns:
    Gmail service object.
  """
  http = httplib2.Http()
  http = credentials.authorize(http)
  return build('gmail', 'v1', http=http)
Code Tutor
expand_more
Send authorized requests and check for revoked credentials
The following code snippet uses an authorized Gmail service instance to retrieve a list of messages.

If an error occurs, the code checks for an HTTP 401 status code, which should be handled by redirecting the user to the authorization URL.

More Gmail API operations are documented in the API Reference.

Python

from googleapiclient import errors

# ...

def ListMessages(service, user, query=''):
  """Gets a list of messages.

  Args:
    service: Authorized Gmail API service instance.
    user: The email address of the account.
    query: String used to filter messages returned.
          Eg.- 'label:UNREAD' for unread Messages only.

  Returns:
    List of messages that match the criteria of the query. Note that the
    returned list contains Message IDs, you must use get with the
    appropriate id to get the details of a Message.
  """
  try:
    response = service.users().messages().list(userId=user, q=query).execute()
    messages = []
    if 'messages' in response:
      messages.extend(response['messages'])

    while 'nextPageToken' in response:
      page_token = response['nextPageToken']
      response = service.users().messages().list(userId=user, q=query,
                                        pageToken=page_token).execute()
      if 'messages' in response:
        messages.extend(response['messages'])

    return messages
  except errors.HttpError as error:
    print('An error occurred: %s' % error)
    if error.resp.status == 401:
      # Credentials have been revoked.
      # TODO: Redirect the user to the authorization URL.
      raise NotImplementedError()
Code Tutor
expand_more
Next steps
Once you are comfortable authorizing Gmail API requests, you're ready to start handling messages, threads, and labels, as described in the Developers Guides sections.

You can learn more about the available API methods in the API Reference.

Warning: When testing your app during development, be sure to use a test Gmail account that you don't care about. This will prevent you from accidentally causing havoc with your actual emails, threads, and labels.JavaScript quickstart

Create a JavaScript web application that makes requests to the Gmail API.

Quickstarts explain how to set up and run an app that calls a Google Workspace API. This quickstart uses a simplified authentication approach that is appropriate for a testing environment. For a production environment, we recommend learning about authentication and authorization before choosing the access credentials that are appropriate for your app.

This quickstart uses Google Workspace's recommended API client libraries to handle some details of the authentication and authorization flow.

Objectives
Set up your environment.
Set up the sample.
Run the sample.
Prerequisites
Node.js & npm installed.
A Google Cloud project.
A Google account with Gmail enabled.
Set up your environment
To complete this quickstart, set up your environment.

Enable the API
Before using Google APIs, you need to turn them on in a Google Cloud project. You can turn on one or more APIs in a single Google Cloud project.
In the Google Cloud console, enable the Gmail API.

Enable the API

Configure the OAuth consent screen
If you're using a new Google Cloud project to complete this quickstart, configure the OAuth consent screen. If you've already completed this step for your Cloud project, skip to the next section.

In the Google Cloud console, go to Menu menu > Google Auth platform > Branding.
Go to Branding

If you have already configured the Google Auth platform, you can configure the following OAuth Consent Screen settings in Branding, Audience, and Data Access. If you see a message that says Google Auth platform not configured yet, click Get Started:
Under App Information, in App name, enter a name for the app.
In User support email, choose a support email address where users can contact you if they have questions about their consent.
Click Next.
Under Audience, select Internal.
Click Next.
Under Contact Information, enter an Email address where you can be notified about any changes to your project.
Click Next.
Under Finish, review the Google API Services User Data Policy and if you agree, select I agree to the Google API Services: User Data Policy.
Click Continue.
Click Create.
For now, you can skip adding scopes. In the future, when you create an app for use outside of your Google Workspace organization, you must change the User type to External. Then add the authorization scopes that your app requires. To learn more, see the full Configure OAuth consent guide.
Authorize credentials for a web application
To authenticate end users and access user data in your app, you need to create one or more OAuth 2.0 Client IDs. A client ID is used to identify a single app to Google's OAuth servers. If your app runs on multiple platforms, you must create a separate client ID for each platform.
In the Google Cloud console, go to Menu menu > Google Auth platform > Clients.
Go to Clients

Click Create Client.
Click Application type > Web application.
In the Name field, type a name for the credential. This name is only shown in the Google Cloud console.
Add authorized URIs related to your app:
Client-side apps (JavaScript)–Under Authorized JavaScript origins, click Add URI. Then, enter a URI to use for browser requests. This identifies the domains from which your application can send API requests to the OAuth 2.0 server.
Server-side apps (Java, Python, and more)–Under Authorized redirect URIs, click Add URI. Then, enter an endpoint URI to which the OAuth 2.0 server can send responses.
Click Create.
The newly created credential appears under OAuth 2.0 Client IDs.

Note the Client ID. Client secrets aren't used for Web applications.

Make a note of these credentials because you need them later in this quickstart.

Create an API key
In the Google Cloud console, go to Menu menu > APIs & Services > Credentials.
Go to Credentials

Click Create credentials > API key.
Your new API key is displayed.
Click Copy content_copy to copy your API key for use in your app's code. The API key can also be found in the "API Keys" section of your project's credentials.
To prevent unauthorized use, we recommend restricting where and for which APIs the API key can be used. For more details, see Add API restrictions.
Set up the sample
In your working directory, create a file named index.html.
In the index.html file, paste the following sample code:


gmail/quickstart/index.htmlView on GitHub

<!DOCTYPE html>
<html>
  <head>
    <title>Gmail API Quickstart</title>
    <meta charset="utf-8" />
  </head>
  <body>
    <p>Gmail API Quickstart</p>

    <!--Add buttons to initiate auth sequence and sign out-->
    <button id="authorize_button" onclick="handleAuthClick()">Authorize</button>
    <button id="signout_button" onclick="handleSignoutClick()">Sign Out</button>

    <pre id="content" style="white-space: pre-wrap;"></pre>

    <script type="text/javascript">
      /* exported gapiLoaded */
      /* exported gisLoaded */
      /* exported handleAuthClick */
      /* exported handleSignoutClick */

      // TODO(developer): Set to client ID and API key from the Developer Console
      const CLIENT_ID = '<YOUR_CLIENT_ID>';
      const API_KEY = '<YOUR_API_KEY>';

      // Discovery doc URL for APIs used by the quickstart
      const DISCOVERY_DOC = 'https://www.googleapis.com/discovery/v1/apis/gmail/v1/rest';

      // Authorization scopes required by the API; multiple scopes can be
      // included, separated by spaces.
      const SCOPES = 'https://www.googleapis.com/auth/gmail.readonly';

      let tokenClient;
      let gapiInited = false;
      let gisInited = false;

      document.getElementById('authorize_button').style.visibility = 'hidden';
      document.getElementById('signout_button').style.visibility = 'hidden';

      /**
       * Callback after api.js is loaded.
       */
      function gapiLoaded() {
        gapi.load('client', initializeGapiClient);
      }

      /**
       * Callback after the API client is loaded. Loads the
       * discovery doc to initialize the API.
       */
      async function initializeGapiClient() {
        await gapi.client.init({
          apiKey: API_KEY,
          discoveryDocs: [DISCOVERY_DOC],
        });
        gapiInited = true;
        maybeEnableButtons();
      }

      /**
       * Callback after Google Identity Services are loaded.
       */
      function gisLoaded() {
        tokenClient = google.accounts.oauth2.initTokenClient({
          client_id: CLIENT_ID,
          scope: SCOPES,
          callback: '', // defined later
        });
        gisInited = true;
        maybeEnableButtons();
      }

      /**
       * Enables user interaction after all libraries are loaded.
       */
      function maybeEnableButtons() {
        if (gapiInited && gisInited) {
          document.getElementById('authorize_button').style.visibility = 'visible';
        }
      }

      /**
       *  Sign in the user upon button click.
       */
      function handleAuthClick() {
        tokenClient.callback = async (resp) => {
          if (resp.error !== undefined) {
            throw (resp);
          }
          document.getElementById('signout_button').style.visibility = 'visible';
          document.getElementById('authorize_button').innerText = 'Refresh';
          await listLabels();
        };

        if (gapi.client.getToken() === null) {
          // Prompt the user to select a Google Account and ask for consent to share their data
          // when establishing a new session.
          tokenClient.requestAccessToken({prompt: 'consent'});
        } else {
          // Skip display of account chooser and consent dialog for an existing session.
          tokenClient.requestAccessToken({prompt: ''});
        }
      }

      /**
       *  Sign out the user upon button click.
       */
      function handleSignoutClick() {
        const token = gapi.client.getToken();
        if (token !== null) {
          google.accounts.oauth2.revoke(token.access_token);
          gapi.client.setToken('');
          document.getElementById('content').innerText = '';
          document.getElementById('authorize_button').innerText = 'Authorize';
          document.getElementById('signout_button').style.visibility = 'hidden';
        }
      }

      /**
       * Print all Labels in the authorized user's inbox. If no labels
       * are found an appropriate message is printed.
       */
      async function listLabels() {
        let response;
        try {
          response = await gapi.client.gmail.users.labels.list({
            'userId': 'me',
          });
        } catch (err) {
          document.getElementById('content').innerText = err.message;
          return;
        }
        const labels = response.result.labels;
        if (!labels || labels.length == 0) {
          document.getElementById('content').innerText = 'No labels found.';
          return;
        }
        // Flatten to string to display
        const output = labels.reduce(
            (str, label) => `${str}${label.name}\n`,
            'Labels:\n');
        document.getElementById('content').innerText = output;
      }
    </script>
    <script async defer src="https://apis.google.com/js/api.js" onload="gapiLoaded()"></script>
    <script async defer src="https://accounts.google.com/gsi/client" onload="gisLoaded()"></script>
  </body>
</html>
Replace the following:

YOUR_CLIENT_ID: the client ID that you created when you authorized credentials for a web application.
YOUR_API_KEY: the API key that you created as a Prerequisite.
Run the sample
In your working directory, install the http-server package:


npm install http-server
In your working directory, start a web server:


npx http-server -p 8000
In your browser, navigate to http://localhost:8000.
You see a prompt to authorize access:
If you're not already signed in to your Google Account, sign in when prompted. If you're signed in to multiple accounts, select one account to use for authorization.
Click Accept.
Your JavaScript application runs and calls the Gmail API.

Next steps
Try the Google Workspace APIs in the APIs explorer
Troubleshoot authentication and authorization issues
Gmail API reference documentation
google-api-javascript-client section of GitHubNode.js quickstart

Create a Node.js command-line application that makes requests to the Gmail API.

Quickstarts explain how to set up and run an app that calls a Google Workspace API. This quickstart uses a simplified authentication approach that is appropriate for a testing environment. For a production environment, we recommend learning about authentication and authorization before choosing the access credentials that are appropriate for your app.

This quickstart uses Google Workspace's recommended API client libraries to handle some details of the authentication and authorization flow.

Objectives
Set up your environment.
Install the client library.
Set up the sample.
Run the sample.
Prerequisites
To run this quickstart, you need the following prerequisites:

Node.js & npm installed.
A Google Cloud project.
A Google account with Gmail enabled.
Set up your environment
To complete this quickstart, set up your environment.

Enable the API
Before using Google APIs, you need to turn them on in a Google Cloud project. You can turn on one or more APIs in a single Google Cloud project.
In the Google Cloud console, enable the Gmail API.

Enable the API

Configure the OAuth consent screen
If you're using a new Google Cloud project to complete this quickstart, configure the OAuth consent screen. If you've already completed this step for your Cloud project, skip to the next section.

In the Google Cloud console, go to Menu menu > Google Auth platform > Branding.
Go to Branding

If you have already configured the Google Auth platform, you can configure the following OAuth Consent Screen settings in Branding, Audience, and Data Access. If you see a message that says Google Auth platform not configured yet, click Get Started:
Under App Information, in App name, enter a name for the app.
In User support email, choose a support email address where users can contact you if they have questions about their consent.
Click Next.
Under Audience, select Internal.
Click Next.
Under Contact Information, enter an Email address where you can be notified about any changes to your project.
Click Next.
Under Finish, review the Google API Services User Data Policy and if you agree, select I agree to the Google API Services: User Data Policy.
Click Continue.
Click Create.
For now, you can skip adding scopes. In the future, when you create an app for use outside of your Google Workspace organization, you must change the User type to External. Then add the authorization scopes that your app requires. To learn more, see the full Configure OAuth consent guide.
Authorize credentials for a desktop application
To authenticate end users and access user data in your app, you need to create one or more OAuth 2.0 Client IDs. A client ID is used to identify a single app to Google's OAuth servers. If your app runs on multiple platforms, you must create a separate client ID for each platform.
Caution: This quickstart must be run locally and with access to a browser. It doesn't work if run on a remote terminal such as Cloud Shell or over SSH.
In the Google Cloud console, go to Menu menu > Google Auth platform > Clients.
Go to Clients

Click Create Client.
Click Application type > Desktop app.
In the Name field, type a name for the credential. This name is only shown in the Google Cloud console.
Click Create.
The newly created credential appears under "OAuth 2.0 Client IDs."

Save the downloaded JSON file as credentials.json, and move the file to your working directory.
Install the client library
Install the libraries using npm:


npm install googleapis@105 @google-cloud/local-auth@2.1.0 --save
Set up the sample
In your working directory, create a file named index.js.

In the file, paste the following code:


gmail/quickstart/index.jsView on GitHub

import path from 'node:path';
import process from 'node:process';
import {authenticate} from '@google-cloud/local-auth';
import {google} from 'googleapis';

// The scope for reading Gmail labels.
const SCOPES = ['https://www.googleapis.com/auth/gmail.readonly'];
// The path to the credentials file.
const CREDENTIALS_PATH = path.join(process.cwd(), 'credentials.json');

/**
 * Lists the labels in the user's account.
 */
async function listLabels() {
  // Authenticate with Google and get an authorized client.
  const auth = await authenticate({
    scopes: SCOPES,
    keyfilePath: CREDENTIALS_PATH,
  });

  // Create a new Gmail API client.
  const gmail = google.gmail({version: 'v1', auth});
  // Get the list of labels.
  const result = await gmail.users.labels.list({
    userId: 'me',
  });
  const labels = result.data.labels;
  if (!labels || labels.length === 0) {
    console.log('No labels found.');
    return;
  }
  console.log('Labels:');
  // Print the name of each label.
  labels.forEach((label) => {
    console.log(`- ${label.name}`);
  });
}

await listLabels();
Code Tutor
expand_more
Run the sample
In your working directory, run the sample:


node .
The first time you run the sample, it prompts you to authorize access:
If you're not already signed in to your Google Account, sign in when prompted. If you're signed in to multiple accounts, select one account to use for authorization.
Click Accept.
Your Nodejs application runs and calls the Gmail API.

Authorization information is stored in the file system, so the next time you run the sample code, you aren't prompted for authorization.

Next steps
Try the Google Workspace APIs in the APIs explorer
Troubleshoot authentication and authorization issues
Gmail API reference documentation
google-api-nodejs-client section of GitHubWorking with Drafts

Drafts represent unsent messages with the DRAFT system label applied. The message contained within the draft cannot be edited once created, but it can be replaced. In this sense, the draft resource is simply a container that provides a stable ID because the underlying message IDs change every time the message is replaced.

Message resources inside a draft have similar behavior to other messages except for the following differences:

Draft messages cannot have any label other than the DRAFT system label.
When the draft is sent, the draft is automatically deleted and a new message with an updated ID is created with the SENT system label. This message is returned in the drafts.send response.
Creating draft messages
Your application can create drafts using the drafts.create method. The general process is to:

Create a MIME message that complies with RFC 2822.
Convert the message to a base64url encoded string.
Create a draft, setting the value of the drafts.message.raw field to the encoded string.
The following code examples demonstrate the process.

Java
Python
gmail/snippets/src/main/java/CreateDraft.javaView on GitHub

import com.google.api.client.googleapis.json.GoogleJsonError;
import com.google.api.client.googleapis.json.GoogleJsonResponseException;
import com.google.api.client.http.HttpRequestInitializer;
import com.google.api.client.http.javanet.NetHttpTransport;
import com.google.api.client.json.gson.GsonFactory;
import com.google.api.services.gmail.Gmail;
import com.google.api.services.gmail.GmailScopes;
import com.google.api.services.gmail.model.Draft;
import com.google.api.services.gmail.model.Message;
import com.google.auth.http.HttpCredentialsAdapter;
import com.google.auth.oauth2.GoogleCredentials;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.util.Properties;
import javax.mail.MessagingException;
import javax.mail.Session;
import javax.mail.internet.InternetAddress;
import javax.mail.internet.MimeMessage;
import org.apache.commons.codec.binary.Base64;

/* Class to demonstrate the use of Gmail Create Draft API */
public class CreateDraft {
  /**
   * Create a draft email.
   *
   * @param fromEmailAddress - Email address to appear in the from: header
   * @param toEmailAddress   - Email address of the recipient
   * @return the created draft, {@code null} otherwise.
   * @throws MessagingException - if a wrongly formatted address is encountered.
   * @throws IOException        - if service account credentials file not found.
   */
  public static Draft createDraftMessage(String fromEmailAddress,
                                         String toEmailAddress)
      throws MessagingException, IOException {
        /* Load pre-authorized user credentials from the environment.
        TODO(developer) - See https://developers.google.com/identity for
         guides on implementing OAuth2 for your application.*/
    GoogleCredentials credentials = GoogleCredentials.getApplicationDefault()
        .createScoped(GmailScopes.GMAIL_COMPOSE);
    HttpRequestInitializer requestInitializer = new HttpCredentialsAdapter(credentials);

    // Create the gmail API client
    Gmail service = new Gmail.Builder(new NetHttpTransport(),
        GsonFactory.getDefaultInstance(),
        requestInitializer)
        .setApplicationName("Gmail samples")
        .build();

    // Create the email content
    String messageSubject = "Test message";
    String bodyText = "lorem ipsum.";

    // Encode as MIME message
    Properties props = new Properties();
    Session session = Session.getDefaultInstance(props, null);
    MimeMessage email = new MimeMessage(session);
    email.setFrom(new InternetAddress(fromEmailAddress));
    email.addRecipient(javax.mail.Message.RecipientType.TO,
        new InternetAddress(toEmailAddress));
    email.setSubject(messageSubject);
    email.setText(bodyText);

    // Encode and wrap the MIME message into a gmail message
    ByteArrayOutputStream buffer = new ByteArrayOutputStream();
    email.writeTo(buffer);
    byte[] rawMessageBytes = buffer.toByteArray();
    String encodedEmail = Base64.encodeBase64URLSafeString(rawMessageBytes);
    Message message = new Message();
    message.setRaw(encodedEmail);

    try {
      // Create the draft message
      Draft draft = new Draft();
      draft.setMessage(message);
      draft = service.users().drafts().create("me", draft).execute();
      System.out.println("Draft id: " + draft.getId());
      System.out.println(draft.toPrettyString());
      return draft;
    } catch (GoogleJsonResponseException e) {
      // TODO(developer) - handle error appropriately
      GoogleJsonError error = e.getDetails();
      if (error.getCode() == 403) {
        System.err.println("Unable to create draft: " + e.getMessage());
      } else {
        throw e;
      }
    }
    return null;
  }
}
Code Tutor
expand_more
Updating drafts
Similarly to creating a draft, to update a draft you must supply a Draft resource in the body of your request with the draft.message.raw field set to a base64url encoded string containing the MIME message. Because messages cannot be updated, the message contained in the draft is destroyed and replaced by the new MIME message supplied in the update request.

You can retrieve the current MIME message contained in the draft by calling drafts.get with the parameter format=raw.

For more information, see drafts.update.

Sending drafts
When sending a draft, you can choose to send the message as-is or as with an updated message. If you are updating the draft content with a new message, supply a Draft resource in the body of the drafts.send request; set the draft.id of the draft to be sent; and set the draft.message.raw field to the new MIME message encoded as a base64url encoded string. For more information, see drafts.send.Sending Email

There are two ways to send email using the Gmail API:

You can send it directly using the messages.send method.
You can send it from a draft, using the drafts.send method.
Emails are sent as base64url encoded strings within the raw property of a message resource. The high-level workflow to send an email is to:

Create the email content in some convenient way and encode it as a base64url string.
Create a new message resource and set its raw property to the base64url string you just created.
Call messages.send, or, if sending a draft, drafts.send to send the message.
The details of this workflow can vary depending on your choice of client library and programming language.

Creating messages
The Gmail API requires MIME email messages compliant with RFC 2822 and encoded as base64url strings. Many programming languages have libraries or utilities that simplify the process of creating and encoding MIME messages. The following code examples demonstrate how to create a MIME message using the Google APIs client libraries for various languages.

Java
Python
Creating an email message can be greatly simplified with the MimeMessage class in the javax.mail.internet package. The following example shows how to create the email message, including the headers:

gmail/snippets/src/main/java/CreateEmail.javaView on GitHub

import java.util.Properties;
import javax.mail.MessagingException;
import javax.mail.Session;
import javax.mail.internet.InternetAddress;
import javax.mail.internet.MimeMessage;

/* Class to demonstrate the use of Gmail Create Email API  */
public class CreateEmail {

  /**
   * Create a MimeMessage using the parameters provided.
   *
   * @param toEmailAddress   email address of the receiver
   * @param fromEmailAddress email address of the sender, the mailbox account
   * @param subject          subject of the email
   * @param bodyText         body text of the email
   * @return the MimeMessage to be used to send email
   * @throws MessagingException - if a wrongly formatted address is encountered.
   */
  public static MimeMessage createEmail(String toEmailAddress,
                                        String fromEmailAddress,
                                        String subject,
                                        String bodyText)
      throws MessagingException {
    Properties props = new Properties();
    Session session = Session.getDefaultInstance(props, null);

    MimeMessage email = new MimeMessage(session);

    email.setFrom(new InternetAddress(fromEmailAddress));
    email.addRecipient(javax.mail.Message.RecipientType.TO,
        new InternetAddress(toEmailAddress));
    email.setSubject(subject);
    email.setText(bodyText);
    return email;
  }
}
Code Tutor
expand_more
The next step is to encode the MimeMessage, instantiate a Message object, and set the base64url encoded message string as the value of the raw property.

gmail/snippets/src/main/java/CreateMessage.javaView on GitHub

import com.google.api.services.gmail.model.Message;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import javax.mail.MessagingException;
import javax.mail.internet.MimeMessage;
import org.apache.commons.codec.binary.Base64;

/* Class to demonstrate the use of Gmail Create Message API */
public class CreateMessage {

  /**
   * Create a message from an email.
   *
   * @param emailContent Email to be set to raw of message
   * @return a message containing a base64url encoded email
   * @throws IOException        - if service account credentials file not found.
   * @throws MessagingException - if a wrongly formatted address is encountered.
   */
  public static Message createMessageWithEmail(MimeMessage emailContent)
      throws MessagingException, IOException {
    ByteArrayOutputStream buffer = new ByteArrayOutputStream();
    emailContent.writeTo(buffer);
    byte[] bytes = buffer.toByteArray();
    String encodedEmail = Base64.encodeBase64URLSafeString(bytes);
    Message message = new Message();
    message.setRaw(encodedEmail);
    return message;
  }
}
Code Tutor
expand_more
Creating messages with attachments
Creating a message with an attachment is like creating any other message, but the process of uploading the file as a multi-part MIME message depends on the programming language. The following code examples demonstrate possible ways of creating a multi-part MIME message with an attachment.

Java
Python
The following example shows how to create a multi-part MIME message, the encoding and assignment steps are the same as above.

gmail/snippets/src/main/java/CreateDraftWithAttachment.javaView on GitHub

import com.google.api.client.googleapis.json.GoogleJsonError;
import com.google.api.client.googleapis.json.GoogleJsonResponseException;
import com.google.api.client.http.HttpRequestInitializer;
import com.google.api.client.http.javanet.NetHttpTransport;
import com.google.api.client.json.gson.GsonFactory;
import com.google.api.services.gmail.Gmail;
import com.google.api.services.gmail.GmailScopes;
import com.google.api.services.gmail.model.Draft;
import com.google.api.services.gmail.model.Message;
import com.google.auth.http.HttpCredentialsAdapter;
import com.google.auth.oauth2.GoogleCredentials;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.IOException;
import java.util.Properties;
import javax.activation.DataHandler;
import javax.activation.DataSource;
import javax.activation.FileDataSource;
import javax.mail.MessagingException;
import javax.mail.Multipart;
import javax.mail.Session;
import javax.mail.internet.InternetAddress;
import javax.mail.internet.MimeBodyPart;
import javax.mail.internet.MimeMessage;
import javax.mail.internet.MimeMultipart;
import org.apache.commons.codec.binary.Base64;

/* Class to demonstrate the use of Gmail Create Draft with attachment API */
public class CreateDraftWithAttachment {
  /**
   * Create a draft email with attachment.
   *
   * @param fromEmailAddress - Email address to appear in the from: header.
   * @param toEmailAddress   - Email address of the recipient.
   * @param file             - Path to the file to be attached.
   * @return the created draft, {@code null} otherwise.
   * @throws MessagingException - if a wrongly formatted address is encountered.
   * @throws IOException        - if service account credentials file not found.
   */
  public static Draft createDraftMessageWithAttachment(String fromEmailAddress,
                                                       String toEmailAddress,
                                                       File file)
      throws MessagingException, IOException {
        /* Load pre-authorized user credentials from the environment.
         TODO(developer) - See https://developers.google.com/identity for
          guides on implementing OAuth2 for your application.*/
    GoogleCredentials credentials = GoogleCredentials.getApplicationDefault()
        .createScoped(GmailScopes.GMAIL_COMPOSE);
    HttpRequestInitializer requestInitializer = new HttpCredentialsAdapter(credentials);

    // Create the gmail API client
    Gmail service = new Gmail.Builder(new NetHttpTransport(),
        GsonFactory.getDefaultInstance(),
        requestInitializer)
        .setApplicationName("Gmail samples")
        .build();

    // Create the email content
    String messageSubject = "Test message";
    String bodyText = "lorem ipsum.";

    // Encode as MIME message
    Properties props = new Properties();
    Session session = Session.getDefaultInstance(props, null);
    MimeMessage email = new MimeMessage(session);
    email.setFrom(new InternetAddress(fromEmailAddress));
    email.addRecipient(javax.mail.Message.RecipientType.TO,
        new InternetAddress(toEmailAddress));
    email.setSubject(messageSubject);

    MimeBodyPart mimeBodyPart = new MimeBodyPart();
    mimeBodyPart.setContent(bodyText, "text/plain");
    Multipart multipart = new MimeMultipart();
    multipart.addBodyPart(mimeBodyPart);
    mimeBodyPart = new MimeBodyPart();
    DataSource source = new FileDataSource(file);
    mimeBodyPart.setDataHandler(new DataHandler(source));
    mimeBodyPart.setFileName(file.getName());
    multipart.addBodyPart(mimeBodyPart);
    email.setContent(multipart);

    // Encode and wrap the MIME message into a gmail message
    ByteArrayOutputStream buffer = new ByteArrayOutputStream();
    email.writeTo(buffer);
    byte[] rawMessageBytes = buffer.toByteArray();
    String encodedEmail = Base64.encodeBase64URLSafeString(rawMessageBytes);
    Message message = new Message();
    message.setRaw(encodedEmail);

    try {
      // Create the draft message
      Draft draft = new Draft();
      draft.setMessage(message);
      draft = service.users().drafts().create("me", draft).execute();
      System.out.println("Draft id: " + draft.getId());
      System.out.println(draft.toPrettyString());
      return draft;
    } catch (GoogleJsonResponseException e) {
      // TODO(developer) - handle error appropriately
      GoogleJsonError error = e.getDetails();
      if (error.getCode() == 403) {
        System.err.println("Unable to create draft: " + e.getDetails());
      } else {
        throw e;
      }
    }
    return null;
  }
}
Code Tutor
expand_more
Sending messages
Once you have created a message, you can send it by supplying it in the request body of a call to messages.send, as demonstrated in the following examples.

Java
Python
gmail/snippets/src/main/java/SendMessage.javaView on GitHub

import com.google.api.client.googleapis.json.GoogleJsonError;
import com.google.api.client.googleapis.json.GoogleJsonResponseException;
import com.google.api.client.http.HttpRequestInitializer;
import com.google.api.client.http.javanet.NetHttpTransport;
import com.google.api.client.json.gson.GsonFactory;
import com.google.api.services.gmail.Gmail;
import com.google.api.services.gmail.GmailScopes;
import com.google.api.services.gmail.model.Message;
import com.google.auth.http.HttpCredentialsAdapter;
import com.google.auth.oauth2.GoogleCredentials;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.util.Properties;
import javax.mail.MessagingException;
import javax.mail.Session;
import javax.mail.internet.InternetAddress;
import javax.mail.internet.MimeMessage;
import org.apache.commons.codec.binary.Base64;

/* Class to demonstrate the use of Gmail Send Message API */
public class SendMessage {
  /**
   * Send an email from the user's mailbox to its recipient.
   *
   * @param fromEmailAddress - Email address to appear in the from: header
   * @param toEmailAddress   - Email address of the recipient
   * @return the sent message, {@code null} otherwise.
   * @throws MessagingException - if a wrongly formatted address is encountered.
   * @throws IOException        - if service account credentials file not found.
   */
  public static Message sendEmail(String fromEmailAddress,
                                  String toEmailAddress)
      throws MessagingException, IOException {
        /* Load pre-authorized user credentials from the environment.
           TODO(developer) - See https://developers.google.com/identity for
            guides on implementing OAuth2 for your application.*/
    GoogleCredentials credentials = GoogleCredentials.getApplicationDefault()
        .createScoped(GmailScopes.GMAIL_SEND);
    HttpRequestInitializer requestInitializer = new HttpCredentialsAdapter(credentials);

    // Create the gmail API client
    Gmail service = new Gmail.Builder(new NetHttpTransport(),
        GsonFactory.getDefaultInstance(),
        requestInitializer)
        .setApplicationName("Gmail samples")
        .build();

    // Create the email content
    String messageSubject = "Test message";
    String bodyText = "lorem ipsum.";

    // Encode as MIME message
    Properties props = new Properties();
    Session session = Session.getDefaultInstance(props, null);
    MimeMessage email = new MimeMessage(session);
    email.setFrom(new InternetAddress(fromEmailAddress));
    email.addRecipient(javax.mail.Message.RecipientType.TO,
        new InternetAddress(toEmailAddress));
    email.setSubject(messageSubject);
    email.setText(bodyText);

    // Encode and wrap the MIME message into a gmail message
    ByteArrayOutputStream buffer = new ByteArrayOutputStream();
    email.writeTo(buffer);
    byte[] rawMessageBytes = buffer.toByteArray();
    String encodedEmail = Base64.encodeBase64URLSafeString(rawMessageBytes);
    Message message = new Message();
    message.setRaw(encodedEmail);

    try {
      // Create send message
      message = service.users().messages().send("me", message).execute();
      System.out.println("Message id: " + message.getId());
      System.out.println(message.toPrettyString());
      return message;
    } catch (GoogleJsonResponseException e) {
      // TODO(developer) - handle error appropriately
      GoogleJsonError error = e.getDetails();
      if (error.getCode() == 403) {
        System.err.println("Unable to send message: " + e.getDetails());
      } else {
        throw e;
      }
    }
    return null;
  }
}
Code Tutor
expand_more
If you're trying to send a reply and want the email to thread, make sure that:

The Subject headers match
The References and In-Reply-To headers follow the RFC 2822 standard.
For information on sending a message from a draft, see Creating Drafts.Uploading Attachments

The Gmail API allows you to upload file data when creating or updating a draft or when inserting or sending a message.

Upload options
The Gmail API allows you to upload certain types of binary data, or media. The specific characteristics of the data you can upload are specified on the reference page for any method that supports media uploads:

Maximum upload file size: The maximum amount of data you can store with this method.
Accepted media MIME types: The types of binary data you can store using this method.
You can make upload requests in any of the following ways. Specify the method you are using with the uploadType request parameter.

Simple upload: uploadType=media. For quick transfer of smaller files, for example, 5 MB or less.
Multipart upload: uploadType=multipart. For quick transfer of smaller files and metadata; transfers the file along with metadata that describes it, all in a single request.
Resumable upload: uploadType=resumable. For reliable transfer, especially important with larger files. With this method, you use a session initiating request, which optionally can include metadata. This is a good strategy to use for most applications, since it also works for smaller files at the cost of one additional HTTP request per upload.
When you upload media, you use a special URI. In fact, methods that support media uploads have two URI endpoints:

The /upload URI, for the media. The format of the upload endpoint is the standard resource URI with an “/upload” prefix. Use this URI when transferring the media data itself.

Example: POST /upload/gmail/v1/users/userId/messages/send

The standard resource URI, for the metadata. If the resource contains any data fields, those fields are used to store metadata describing the uploaded file. You can use this URI when creating or updating metadata values.

Example: POST /gmail/v1/users/userId/messages/send

Simple upload 
The most straightforward method for uploading a file is by making a simple upload request. This option is a good choice when:

The file is small enough to upload again in its entirety if the connection fails.
There is no metadata to send. This might be true if you plan to send metadata for this resource in a separate request, or if no metadata is supported or available.
To use simple upload, make a POST or PUT request to the method's /upload URI and add the query parameter uploadType=media. For example:


POST https://www.googleapis.com/upload/gmail/v1/users/userId/messages/send?uploadType=media
The HTTP headers to use when making a simple upload request include:

Content-Type. Set to one of the method's accepted upload media data types, specified in the API reference.
Content-Length. Set to the number of bytes you are uploading. Not required if you are using chunked transfer encoding.
Example: Simple upload
The following example shows the use of a simple upload request for the Gmail API.


POST /upload/gmail/v1/users/userId/messages/send?uploadType=media HTTP/1.1
Host: www.googleapis.com
Content-Type: message/rfc822
Content-Length: number_of_bytes_in_file
Authorization: Bearer your_auth_token

Email Message data
If the request succeeds, the server returns the HTTP 200 OK status code along with any metadata:


HTTP/1.1 200
Content-Type: application/json

{
  "id": string,
  "threadId": string,
  "labelIds": [
    string
  ],
  "snippet": string,
  "historyId": unsigned long,
  "payload": {
    "partId": string,
    "mimeType": string,
    "filename": string,
    "headers": [
      {
        "name": string,
        "value": string
      }
    ],
    "body": users.messages.attachments Resource,
    "parts": [
      (MessagePart)
    ]
  },
  "sizeEstimate": integer,
  "raw": bytes
}
Multipart upload
If you have metadata that you want to send along with the data to upload, you can make a single multipart/related request. This is a good choice if the data you are sending is small enough to upload again in its entirety if the connection fails.

To use multipart upload, make a POST or PUT request to the method's /upload URI and add the query parameter uploadType=multipart, for example:


POST https://www.googleapis.com/upload/gmail/v1/users/userId/messages/send?uploadType=multipart
The top-level HTTP headers to use when making a multipart upload request include:

Content-Type. Set to multipart/related and include the boundary string you're using to identify the parts of the request.
Content-Length. Set to the total number of bytes in the request body. The media portion of the request must be less than the maximum file size specified for this method.
The body of the request is formatted as a multipart/related content type [RFC2387] and contains exactly two parts. The parts are identified by a boundary string, and the final boundary string is followed by two hyphens.

Each part of the multipart request needs an additional Content-Type header:

Metadata part: Must come first, and Content-Type must match one of the accepted metadata formats.
Media part: Must come second, and Content-Type must match one the method's accepted media MIME types.
See the API reference for each method's list of accepted media MIME types and size limits for uploaded files.

Note: To create or update the metadata portion only, without uploading the associated data, simply send a POST or PUT request to the standard resource endpoint: https://www.googleapis.com/gmail/v1/users/userId/messages/send

Example: Multipart upload
The example below shows a multipart upload request for the Gmail API.


POST /upload/gmail/v1/users/userId/messages/send?uploadType=multipart HTTP/1.1
Host: www.googleapis.com
Authorization: Bearer your_auth_token
Content-Type: multipart/related; boundary=foo_bar_baz
Content-Length: number_of_bytes_in_entire_request_body

--foo_bar_baz
Content-Type: application/json; charset=UTF-8

{
  "id": string,
  "threadId": string,
  "labelIds": [
    string
  ],
  "snippet": string,
  "historyId": unsigned long,
  "payload": {
    "partId": string,
    "mimeType": string,
    "filename": string,
    "headers": [
      {
        "name": string,
        "value": string
      }
    ],
    "body": users.messages.attachments Resource,
    "parts": [
      (MessagePart)
    ]
  },
  "sizeEstimate": integer,
  "raw": bytes
}

--foo_bar_baz
Content-Type: message/rfc822

Email Message data
--foo_bar_baz--
If the request succeeds, the server returns the HTTP 200 OK status code along with any metadata:


HTTP/1.1 200
Content-Type: application/json

{
  "id": string,
  "threadId": string,
  "labelIds": [
    string
  ],
  "snippet": string,
  "historyId": unsigned long,
  "payload": {
    "partId": string,
    "mimeType": string,
    "filename": string,
    "headers": [
      {
        "name": string,
        "value": string
      }
    ],
    "body": users.messages.attachments Resource,
    "parts": [
      (MessagePart)
    ]
  },
  "sizeEstimate": integer,
  "raw": bytes
}
Resumable upload
To upload data files more reliably, you can use the resumable upload protocol. This protocol allows you to resume an upload operation after a communication failure has interrupted the flow of data. It is especially useful if you are transferring large files and the likelihood of a network interruption or some other transmission failure is high, for example, when uploading from a mobile client app. It can also reduce your bandwidth usage in the event of network failures because you don't have to restart large file uploads from the beginning.

The steps for using resumable upload include:

Start a resumable session. Make an initial request to the upload URI that includes the metadata, if any.
Save the resumable session URI. Save the session URI returned in the response of the initial request; you'll use it for the remaining requests in this session.
Upload the file. Send the media file to the resumable session URI.
In addition, apps that use resumable upload need to have code to resume an interrupted upload. If an upload is interrupted, find out how much data was successfully received, and then resume the upload starting from that point.

Note: An upload URI expires after one week.

Step 1: Start a resumable session
To initiate a resumable upload, make a POST or PUT request to the method's /upload URI and add the query parameter uploadType=resumable, for example:


POST https://www.googleapis.com/upload/gmail/v1/users/userId/messages/send?uploadType=resumable
For this initiating request, the body is either empty or it contains the metadata only; you'll transfer the actual contents of the file you want to upload in subsequent requests.

Use the following HTTP headers with the initial request:
X-Upload-Content-Type. Set to the media MIME type of the upload data to be transferred in subsequent requests.
X-Upload-Content-Length. Set to the number of bytes of upload data to be transferred in subsequent requests.  If the length is unknown at the time of this request, you can omit this header.
If providing metadata: Content-Type. Set according to the metadata's data type.
Content-Length. Set to the number of bytes provided in the body of this initial request. Not required if you are using chunked transfer encoding.
See the API reference for each method's list of accepted media MIME types and size limits for uploaded files.

Example: Resumable session initiation request
The following example shows how to initiate a resumable session for the Gmail API.


POST /upload/gmail/v1/users/userId/messages/send?uploadType=resumable HTTP/1.1
Host: www.googleapis.com
Authorization: Bearer your_auth_token
Content-Length: 38
Content-Type: application/json; charset=UTF-8
X-Upload-Content-Type: message/rfc822
X-Upload-Content-Length: 2000000

{
  "id": string,
  "threadId": string,
  "labelIds": [
    string
  ],
  "snippet": string,
  "historyId": unsigned long,
  "payload": {
    "partId": string,
    "mimeType": string,
    "filename": string,
    "headers": [
      {
        "name": string,
        "value": string
      }
    ],
    "body": users.messages.attachments Resource,
    "parts": [
      (MessagePart)
    ]
  },
  "sizeEstimate": integer,
  "raw": bytes
}
Note: For an initial resumable update request without metadata, leave the body of the request empty, and set the Content-Length header to 0.

The next section describes how to handle the response.

Step 2: Save the resumable session URI
If the session initiation request succeeds, the API server responds with a 200 OK HTTP status code. In addition, it provides a Location header that specifies your resumable session URI. The Location header, shown in the example below, includes an upload_id query parameter portion that gives the unique upload ID to use for this session.

Example: Resumable session initiation response
Here is the response to the request in Step 1:


HTTP/1.1 200 OK
Location: https://www.googleapis.com/upload/gmail/v1/users/userId/messages/send?uploadType=resumable&upload_id=xa298sd_sdlkj2
Content-Length: 0
The value of the Location header, as shown in the above example response, is the session URI you'll use as the HTTP endpoint for doing the actual file upload or querying the upload status.

Copy and save the session URI so you can use it for subsequent requests.

Step 3: Upload the file
To upload the file, send a PUT request to the upload URI that you obtained in the previous step. The format of the upload request is:


PUT session_uri
The HTTP headers to use when making the resumable file upload requests includes Content-Length. Set this to the number of bytes you are uploading in this request, which is generally the upload file size.

Example: Resumable file upload request
Here is a resumable request to upload the entire 2,000,000 byte Email Message file for the current example.


PUT https://www.googleapis.com/upload/gmail/v1/users/userId/messages/send?uploadType=resumable&upload_id=xa298sd_sdlkj2 HTTP/1.1
Content-Length: 2000000
Content-Type: message/rfc822

bytes 0-1999999
If the request succeeds, the server responds with an HTTP 201 Created, along with any metadata associated with this resource. If the initial request of the resumable session had been a PUT, to update an existing resource, the success response would be  200 OK, along with any metadata associated with this resource.

If the upload request is interrupted or if you receive an HTTP 503 Service Unavailable or any other 5xx response from the server, follow the procedure outlined in resume an interrupted upload.  

Uploading the file in chunks
With resumable uploads, you can break a file into chunks and send a series of requests to upload each chunk in sequence. This is not the preferred approach since there are performance costs associated with the additional requests, and it is generally not needed. However, you might need to use chunking to reduce the amount of data transferred in any single request. This is helpful when there is a fixed time limit for individual requests, as is true for certain classes of Google App Engine requests. It also lets you do things like providing upload progress indications for legacy browsers that don't have upload progress support by default.

Expand for more info
Resume an interrupted upload
If an upload request is terminated before receiving a response or if you receive an HTTP 503 Service Unavailable response from the server, then you need to resume the interrupted upload. To do this:

Request status. Query the current status of the upload by issuing an empty PUT request to the upload URI. For this request, the HTTP headers should include a Content-Range header indicating that the current position in the file is unknown.  For example, set the Content-Range to */2000000 if your total file length is 2,000,000. If you don't know the full size of the file, set the Content-Range to */*.
Note: You can request the status between chunks, not just if the upload is interrupted. This is useful, for example, if you want to show upload progress indications for legacy browsers.

Get number of bytes uploaded. Process the response from the status query. The server uses the Range header in its response to specify which bytes it has received so far.  For example, a Range header of 0-299999 indicates that the first 300,000 bytes of the file have been received.
Upload remaining data. Finally, now that you know where to resume the request, send the remaining data or current chunk. Note that you need to treat the remaining data as a separate chunk in either case, so you need to send the Content-Range header when you resume the upload.
Example: Resuming an interrupted upload
1) Request the upload status.

The following request uses the Content-Range header to indicate that the current position in the 2,000,000 byte file is unknown.


PUT {session_uri} HTTP/1.1
Content-Length: 0
Content-Range: bytes */2000000
2) Extract the number of bytes uploaded so far from the response.

The server's response uses the Range header to indicate that it has received the first 43 bytes of the file so far. Use the upper value of the Range header to determine where to start the resumed upload.


HTTP/1.1 308 Resume Incomplete
Content-Length: 0
Range: 0-42
Note: It is possible that the status response could be 201 Created or 200 OK if the upload is complete. This could happen if the connection broke after all bytes were uploaded but before the client received a response from the server.

3) Resume the upload from the point where it left off.

The following request resumes the upload by sending the remaining bytes of the file, starting at byte 43.


PUT {session_uri} HTTP/1.1
Content-Length: 1999957
Content-Range: bytes 43-1999999/2000000

bytes 43-1999999
Best practices
When uploading media, it is helpful to be aware of some best practices related to error handling.

Resume or retry uploads that fail due to connection interruptions or any 5xx errors, including:
500 Internal Server Error
502 Bad Gateway
503 Service Unavailable
504 Gateway Timeout
Use an exponential backoff strategy if any 5xx server error is returned when resuming or retrying upload requests. These errors can occur if a server is getting overloaded. Exponential backoff can help alleviate these kinds of problems during periods of high volume of requests or heavy network traffic.
Other kinds of requests should not be handled by exponential backoff but you can still retry a number of them. When retrying these requests, limit the number of times you retry them. For example your code could limit to ten retries or less before reporting an error.
Handle 404 Not Found and 410 Gone errors when doing resumable uploads by starting the entire upload over from the beginning.
Exponential backoff
Exponential backoff is a standard error handling strategy for network applications in which the client periodically retries a failed request over an increasing amount of time. If a high volume of requests or heavy network traffic causes the server to return errors, exponential backoff may be a good strategy for handling those errors. Conversely, it is not a relevant strategy for dealing with errors unrelated to network volume or response times, such as invalid authorization credentials or file not found errors.

Used properly, exponential backoff increases the efficiency of bandwidth usage, reduces the number of requests required to get a successful response, and maximizes the throughput of requests in concurrent environments.

The flow for implementing simple exponential backoff is as follows:

Make a request to the API.
Receive an HTTP 503 response, which indicates you should retry the request.
Wait 1 second + random_number_milliseconds and retry the request.
Receive an HTTP 503 response, which indicates you should retry the request.
Wait 2 seconds + random_number_milliseconds, and retry the request.
Receive an HTTP 503 response, which indicates you should retry the request.
Wait 4 seconds + random_number_milliseconds, and retry the request.
Receive an HTTP 503 response, which indicates you should retry the request.
Wait 8 seconds + random_number_milliseconds, and retry the request.
Receive an HTTP 503 response, which indicates you should retry the request.
Wait 16 seconds + random_number_milliseconds, and retry the request.
Stop. Report or log an error.
In the above flow, random_number_milliseconds is a random number of milliseconds less than or equal to 1000. This is necessary, since introducing a small random delay helps distribute the load more evenly and avoid the possibility of stampeding the server. The value of random_number_milliseconds must be redefined after each wait.

Note: The wait is always (2 ^ n) + random_number_milliseconds, where n is a monotonically increasing integer initially defined as 0. The integer n is incremented by 1 for each iteration (each request).

The algorithm is set to terminate when n is 5. This ceiling prevents clients from retrying infinitely, and results in a total delay of around 32 seconds before a request is deemed "an unrecoverable error." A larger maximum number of retries is fine, especially if a long upload is in progress; just be sure to cap the retry delay at something reasonable, say, less than one minute.

API client library guides
.NET
Java
PHP
Python
Ruby
Managing Threads

The Gmail API uses Thread resources to group email replies with their original message into a single conversation or thread. This allows you to retrieve all messages in a conversation, in order, making it easier to have context for a message or to refine search results.

Like messages, threads may also have labels applied to them. However, unlike messages, threads cannot be created, only deleted. Messages can, however, be inserted into a thread.

Retrieving threads
Threads provide a simple way of retrieving messages in a conversation in order. By listing a set of threads you can choose to group messages by conversation and provide additional context. You can retrieve a list of threads using the threads.list method, or retrieve a specific thread with threads.get. You can also filter threads using the same query parameters as for the Message resource. If any message in a thread matches the query, that thread is returned in the result.


The code sample below demonstrates how to use both methods in a sample that displays the most chatty threads in your inbox. The threads.list method fetches all thread IDs, then threads.get grabs all messages in each thread. For those with 3 or more replies, we extract the Subject line and display the non-empty ones plus the number of messages in the thread. You'll also find this code sample featured in the corresponding DevByte video.

Python
gmail/snippet/thread/threads.pyView on GitHub

import google.auth
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError


def show_chatty_threads():
  """Display threads with long conversations(>= 3 messages)
  Return: None

  Load pre-authorized user credentials from the environment.
  TODO(developer) - See https://developers.google.com/identity
  for guides on implementing OAuth2 for the application.
  """
  creds, _ = google.auth.default()

  try:
    # create gmail api client
    service = build("gmail", "v1", credentials=creds)

    # pylint: disable=maybe-no-member
    # pylint: disable:R1710
    threads = (
        service.users().threads().list(userId="me").execute().get("threads", [])
    )
    for thread in threads:
      tdata = (
          service.users().threads().get(userId="me", id=thread["id"]).execute()
      )
      nmsgs = len(tdata["messages"])

      # skip if <3 msgs in thread
      if nmsgs > 2:
        msg = tdata["messages"][0]["payload"]
        subject = ""
        for header in msg["headers"]:
          if header["name"] == "Subject":
            subject = header["value"]
            break
        if subject:  # skip if no Subject line
          print(f"- {subject}, {nmsgs}")
    return threads

  except HttpError as error:
    print(f"An error occurred: {error}")


if __name__ == "__main__":
  show_chatty_threads()
Code Tutor
expand_more
Adding drafts and messages to threads
If you are sending or migrating messages that are a response to another email or part of a conversation, your application should add that message to the related thread. This makes it easier for Gmail users who are participating in the conversation to keep the message in context.

A draft can be added to a thread as part of creating, updating, or sending a draft message. You can also add a message to a thread as part of inserting or sending a message.

In order to be part of a thread, a message or draft must meet the following criteria:

The requested threadId must be specified on the Message or Draft.Message you supply with your request.
The References and In-Reply-To headers must be set in compliance with the RFC 2822 standard.
The Subject headers must match.
Take a look at the creating a draft or sending a message examples. In both cases, you would simply add a threadId key paired with a thread ID to a message's metadata, the message object.Manage labels

You can use labels to tag, organize, and categorize messages and threads in Gmail. A label has a many-to-many relationship with messages and threads: you can apply multiple labels to a single message or thread and apply a single label to multiple messages or threads.

For information about how to create, get, list, update, or delete labels, see the Labels reference.

To manage labels, you must use the https://www.googleapis.com/auth/gmail.labels scope. For more information about scopes, see Gmail API-specific authorization and authentication information.

Types of labels
Labels come in two varieties: reserved SYSTEM labels and custom USER labels. System labels typically correspond to pre-defined elements in the Gmail web interface such as the inbox. Systems label names are reserved; no USER label can be created with the same name as any SYSTEM label. The following table lists several of the most common Gmail system labels:

Name	Can be manually applied	Notes
INBOX	yes	
SPAM	yes	
TRASH	yes	
UNREAD	yes	
STARRED	yes	
IMPORTANT	yes	
SENT	no	Applied automatically to messages that are sent with drafts.send or messages.send, inserted with messages.insert and the user's email in the From header, or sent by the user through the web interface.
DRAFT	no	Automatically applied to all draft messages created with the Gmail API or Gmail interface.
CATEGORY_PERSONAL	yes	Corresponds to messages that are displayed in the Personal tab of the Gmail interface.
CATEGORY_SOCIAL	yes	Corresponds to messages that are displayed in the Social tab of the Gmail interface.
CATEGORY_PROMOTIONS	yes	Corresponds to messages that are displayed in the Promotions tab of the Gmail interface.
CATEGORY_UPDATES	yes	Corresponds to messages that are displayed in the Updates tab of the Gmail interface.
CATEGORY_FORUMS	yes	Corresponds to messages that are displayed in the Forums tab of the Gmail interface.
Note: The above list is not exhaustive and other reserved label names exist. Attempting to create a custom label with a name that conflicts with a reserved name results in an HTTP 400 - Invalid label name error.
Manage labels on messages & threads
Labels only exist on messages. For instance, if you list labels on a thread, you get a list of labels that exist on any of the messages within the thread. A label might not exist on every message within a thread. You can apply multiple labels to messages, but you can't apply labels to draft messages.

Add or remove labels to threads
When you add or remove a label to a thread, you add or remove the specified label on all existing messages in the thread.

If messages are added to a thread after you add a label, the new messages don't inherit the existing label associated with the thread. To add the label to those messages, add the label to the thread again.

To add or remove the labels associated with a thread, use threads.modify.

Add or remove labels to messages
When you add a label to a message, the label is added to that message and becomes associated with the thread to which the message belongs. The label isn't added to other messages within the thread.

If you remove a label from a message and it was the only message in the thread with that label, the label is also removed from the thread.

To add or remove the labels applied to a message, use messages.modify.

Searching for Messages

You can search or filter files using the messages.list and threads.list methods. These methods accept the q parameter which supports most of the same advanced search syntax as the Gmail web-interface. For a list of search and filter differences between the Gmail UI and Gmail API, see Search filter differences: Gmail UI versus Gmail API.

This advanced syntax allows you to use search queries to filter messages by properties such as the sender, date, or label to name a few possibilities. For example, the following query retrieves all messages sent by the user in January of 2014:


GET https://www.googleapis.com/gmail/v1/users/me/messages?q=in:sent after:2014/01/01 before:2014/02/01
Warning: All dates used in the search query are interpreted as midnight on that date in the PST timezone. To specify accurate dates for other timezones pass the value in seconds instead:

?q=in:sent after:1388552400 before:1391230800
In addition to search queries, you can also filter messages and threads by label with the labelIds parameter. This allows you to search for messages and threads with the specified system or user labels applied. For more information, see the messages.list or threads.list method reference.

Search and filter differences: Gmail UI versus Gmail API
The Gmail UI performs alias expansion which allows it to infer an account alias from a Google Workspace account. For example, suppose you have an account of myprimary@mycompany.net and your admin sets up an alias for that account of myalias@mycompany.net. If myalias@mycompany.net sends an email, but you search for "from: myprimary@mycompany.net)" the email sent by myalias@mycompany.net shows up as a search result the Gmail UI, but not in the API response.

The Gmail UI allows users to perform thread-wide searches, but the API doesn't.List Gmail messages

This page explains how to call the Gmail API's users.messages.list method.

The method returns an array of Gmail Message resources that contain the message id and threadId. To retrieve full message details, use the users.messages.get method.

Prerequisites
Python
A Google Cloud project with the Gmail API enabled. For steps, complete the Gmail API Python quickstart.

List messages
The users.messages.list method supports several query parameters to filter the messages:

maxResults: Maximum number of messages to return (defaults to 100, max 500).
pageToken: Token to retrieve a specific page of results.
q: Query string to filter messages, such as from:someuser@example.com is:unread".
labelIds: Only return messages with labels that match all specified label IDs.
includeSpamTrash: Include messages from SPAM and TRASH in the results.
Code sample
Python
The following code sample shows how to list messages for the authenticated Gmail user. The code handles pagination to retrieve all messages matching the query.

gmail/snippet/list_messages.pyView on GitHub

import os.path
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

# If modifying these scopes, delete the file token.json.
SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"]


def main():
    """Shows basic usage of the Gmail API.
    Lists the user's Gmail messages.
    """
    creds = None
    # The file token.json stores the user's access and refresh tokens, and is
    # created automatically when the authorization flow completes for the first
    # time.
    if os.path.exists("token.json"):
        creds = Credentials.from_authorized_user_file("token.json", SCOPES)
    # If there are no (valid) credentials available, let the user log in.
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            flow = InstalledAppFlow.from_client_secrets_file("credentials.json", SCOPES)
            creds = flow.run_local_server(port=0)
        # Save the credentials for the next run
        with open("token.json", "w") as token:
            token.write(creds.to_json())

    try:
        # Call the Gmail API
        service = build("gmail", "v1", credentials=creds)
        results = (
            service.users().messages().list(userId="me", labelIds=["INBOX"]).execute()
        )
        messages = results.get("messages", [])

        if not messages:
            print("No messages found.")
            return

        print("Messages:")
        for message in messages:
            print(f'Message ID: {message["id"]}')
            msg = (
                service.users().messages().get(userId="me", id=message["id"]).execute()
            )
            print(f'  Subject: {msg["snippet"]}')

    except HttpError as error:
        # TODO(developer) - Handle errors from gmail API.
        print(f"An error occurred: {error}")


if __name__ == "__main__":
    main()
Code Tutor
expand_more
The users.messages.list method returns a response body that contains the following:

messages[]: An array of Message resources.
nextPageToken: For requests with multiple pages of results, a token that can be used with a subsequent calls to list more messages.
resultSizeEstimate: An estimated total number of results.
To fetch the full message content and metadata, use the message.id field to call the users.messages.get method.

Related resources
users.messages.list
users.messages.get
atching Requests

This document shows how to batch API calls together to reduce the number of HTTP connections your client has to make.

This document is specifically about making a batch request by sending an HTTP request. If, instead, you're using a Google client library to make a batch request, see the client library's documentation.

Overview
Each HTTP connection your client makes results in a certain amount of overhead. The Gmail API supports batching, to allow your client to put several API calls into a single HTTP request.

Examples of situations when you might want to use batching:

You've just started using the API and you have a lot of data to upload.
A user made changes to data while your application was offline (disconnected from the Internet), so your application needs to synchronize its local data with the server by sending a lot of updates and deletes.
In each case, instead of sending each call separately, you can group them together into a single HTTP request. All the inner requests must go to the same Google API.

You're limited to 100 calls in a single batch request. If you must make more calls than that, use multiple batch requests.

Note: The batch system for the Gmail API uses the same syntax as the OData batch processing system, but the semantics differ.


Note: Larger batch sizes are likely to trigger rate limiting. Sending batches larger than 50 requests is not recommended.

Batch details
A batch request consists of multiple API calls combined into one HTTP request, which can be sent to the batchPath specified in the API discovery document. The default path is /batch/api_name/api_version. This section describes the batch syntax in detail; later, there's an example.

Note: A set of n requests batched together counts toward your usage limit as n requests, not as one request. The batch request is separated into a set of requests before processing.

Format of a batch request
A batch request is a single standard HTTP request containing multiple Gmail API calls, using the multipart/mixed content type. Within that main HTTP request, each of the parts contains a nested HTTP request.

Each part begins with its own Content-Type: application/http HTTP header. It can also have an optional Content-ID header. However, the part headers are just there to mark the beginning of the part; they're separate from the nested request. After the server unwraps the batch request into separate requests, the part headers are ignored.

The body of each part is a complete HTTP request, with its own verb, URL, headers, and body. The HTTP request must only contain the path portion of the URL; full URLs are not allowed in batch requests.

The HTTP headers for the outer batch request, except for the Content- headers such as Content-Type, apply to every request in the batch. If you specify a given HTTP header in both the outer request and an individual call, then the individual call header's value overrides the outer batch request header's value. The headers for an individual call apply only to that call.

For example, if you provide an Authorization header for a specific call, then that header applies only to that call. If you provide an Authorization header for the outer request, then that header applies to all of the individual calls unless they override it with Authorization headers of their own.

When the server receives the batched request, it applies the outer request's query parameters and headers (as appropriate) to each part, and then treats each part as if it were a separate HTTP request.

Response to a batch request
The server's response is a single standard HTTP response with a multipart/mixed content type; each part is the response to one of the requests in the batched request, in the same order as the requests.

Like the parts in the request, each response part contains a complete HTTP response, including a status code, headers, and body. And like the parts in the request, each response part is preceded by a Content-Type header that marks the beginning of the part.

If a given part of the request had a Content-ID header, then the corresponding part of the response has a matching Content-ID header, with the original value preceded by the string response-, as shown in the following example.

Note: The server might perform your calls in any order. Don't count on their being executed in the order in which you specified them. If you want to ensure that two calls occur in a given order, you can't send them in a single request; instead, send the first one by itself, then wait for the response to the first one before sending the second one.

Example
The following example shows the use of batching with a generic (fictional) demo API called the Farm API. However, the same concepts apply to the Gmail API.

Example batch request

POST /batch/farm/v1 HTTP/1.1
Authorization: Bearer your_auth_token
Host: www.googleapis.com
Content-Type: multipart/mixed; boundary=batch_foobarbaz
Content-Length: total_content_length

--batch_foobarbaz
Content-Type: application/http
Content-ID: <item1:12930812@barnyard.example.com>

GET /farm/v1/animals/pony

--batch_foobarbaz
Content-Type: application/http
Content-ID: <item2:12930812@barnyard.example.com>

PUT /farm/v1/animals/sheep
Content-Type: application/json
Content-Length: part_content_length
If-Match: "etag/sheep"

{
  "animalName": "sheep",
  "animalAge": "5"
  "peltColor": "green",
}

--batch_foobarbaz
Content-Type: application/http
Content-ID: <item3:12930812@barnyard.example.com>

GET /farm/v1/animals
If-None-Match: "etag/animals"

--batch_foobarbaz--
Example batch response
This is the response to the example request in the previous section.


HTTP/1.1 200
Content-Length: response_total_content_length
Content-Type: multipart/mixed; boundary=batch_foobarbaz

--batch_foobarbaz
Content-Type: application/http
Content-ID: <response-item1:12930812@barnyard.example.com>

HTTP/1.1 200 OK
Content-Type application/json
Content-Length: response_part_1_content_length
ETag: "etag/pony"

{
  "kind": "farm#animal",
  "etag": "etag/pony",
  "selfLink": "/farm/v1/animals/pony",
  "animalName": "pony",
  "animalAge": 34,
  "peltColor": "white"
}

--batch_foobarbaz
Content-Type: application/http
Content-ID: <response-item2:12930812@barnyard.example.com>

HTTP/1.1 200 OK
Content-Type: application/json
Content-Length: response_part_2_content_length
ETag: "etag/sheep"

{
  "kind": "farm#animal",
  "etag": "etag/sheep",
  "selfLink": "/farm/v1/animals/sheep",
  "animalName": "sheep",
  "animalAge": 5,
  "peltColor": "green"
}

--batch_foobarbaz
Content-Type: application/http
Content-ID: <response-item3:12930812@barnyard.example.com>

HTTP/1.1 304 Not Modified
ETag: "etag/animals"

--batch_foobarbaz--