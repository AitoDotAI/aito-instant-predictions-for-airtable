# Instant Predictions for Airtable

_Instant Predictions_ for [Airtable](https://www.airtable.com/) connects your
tables with to your [Aito](https://aito.ai) instance and lets you easily upload
data and make predictions of missing values in an incomplete data set.

Aito is an automated platform for implementing Machine Learning predictions.
What sets Aito apart from other tools providing a similar functionality is the
speed and ease-of-use. Aito removes the need for a separate training phase in
your workflow and is thus perfectly suited for your automation platform or
low-/no-code data storage.

This Airtable application allows you to integrate your Airtable data with Aito.
You can create a view from an existing spreadsheet, and the application will
create the corresponding dataset in Aito. The dataset can then be used to fill
in the value for any missing column in the spreadsheet.

## Configuration

In order to use the application, you will need to

1. [Sign up](https://airtable.com/signup) for an Airtable-account and log in
2. Create an Airtable base and upload some data.
3. [Create an Aito-account](https://console.aito.ai) and create an instance. A
Sandbox is free, and you don't need to add a credit card.
4. Configure the app with the instance URL and your read/write API-key
5. Upload your data using the app

## Installing

Create new custom Airtable app in your base, and follow the instructions and
make note of the _block identifier_ that looks something like
`app12345678/blk12345678`. Clone this repository, navigate to the sources in a
terminal and run

```sh
npm install

# Optional: Set your API key if haven't already
npx block set-api-key ${YOUR_AIRTABLE_API_KEY}

# Set up the remote in your base using the block identifier you got earlier
npx block add-remote ${BLOCKIDENTIFIER} my-base

# Alternative 1: create a release for the base so that all
# collaborator can use the app.
npx block release --remote my-base

# Alternative 2: start the app in development mode
npx block run --remote my-base
```

## MIT License

Aito Instant Predictions is released under an MIT License.
