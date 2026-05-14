# Getting Started

Welcome to your new CAP project.

It contains these folders and files, following our recommended project layout:

File or Folder | Purpose
---------|----------
`app/` | content for UI frontends goes here
`db/` | your domain models and data go here
`srv/` | your service models and code go here
`readme.md` | this getting started guide

## Next Steps

- Open a new terminal and run `cds watch`
- (in VS Code simply choose _**Terminal** > Run Task > cds watch_)
- Start with your domain model, in a CDS file in `db/`

## Learn More

Learn more at <https://cap.cloud.sap>.
add emp - validations
In add emp- marital status- if yes then partner name, marriage date, kids (yes or no)
            work location.
leave portal - every emp except cofounders 
1. 6 months maternity leave, 2 working days paternity leave
2. 21 days total , 5 casual, 5 sick, 11 paid
if emp didn't login for 3 consecutive days then manager should be notified and emp should get a mail.

performance rating monthly- will be done by manager

will figure out
punch in - punchout
