/**
 * A node script for booking classes at 24/7 gyms.
 * The script works by signing in to your account 5 minutes before the booking opens,
 * it then grabs your session cookie, waits until booking opens and then tries to book the class at the exact time it opens.
 */

const readline = require("readline");
const axios = require('axios');
const puppeteer = require('puppeteer')

const gymids = "lund-centrum" // Change this to your gym

process.env.TZ = 'Europe/Amsterdam'
const ONE_HOUR = 60 * 60 * 1000
const ONE_DAY = 24 * ONE_HOUR
let getClassesURL = "https://digitalplatform-prod-svc.azurewebsites.net/v2/Booking/sv-SE/Classes?gymIds=" + gymids
let bookClassURL = "https://digitalplatform-prod-svc.azurewebsites.net/v2/Booking/"
let headers = { "Authorization": null }

async function main() {
    const args = process.argv
    const email = args[2]
    const password = args[3]

    if(!email || !password || !email.includes('@') || password.includes('@')) {
        console.log("Run with: node 247-class-booker.js <email> <password>")
        return
    }

    const mappedClasses = await getClasses()

    const classToBook = await askForClassToBook(mappedClasses)
    let startsTime = classToBook["starts"]

    //
    // Sleep until 5 mins before to get cookie
    //
    let timeToWakeUp = new Date(startsTime.getTime() - (2 * ONE_DAY) - 5 * 60 * 1000)
    console.log("going to sleep until " + timeToWakeUp, '(+ 2H)')

    await sleep(timeToWakeUp - new Date())
    
    console.log("WOKE UP! Time is: " + new Date())
    console.log("Getting cookie" + new Date())
    
    // Get Cookie!
    for(let i = 0; i < 5; i++){
        try {
            headers["Authorization"] = await scrapeCookie()
	    break;
        } catch (err) { console.log('failed to get cookie, retrying') }
    }

    console.log('got bearer ', headers["Authorization"])

    //
    // Sleep until 0.5 seconds before to run script
    //
    timeToWakeUp = new Date(startsTime.getTime() - (2 * ONE_DAY))
    console.log("going to sleep until " + timeToWakeUp, '(+ 2H)')
    await sleep(timeToWakeUp - new Date())
    console.log("WOKE UP! Time is: " + new Date())

    // Make 10 requests, space out with 0.5 seconds
    let newBookClassURL = bookClassURL + "BookClass?classId=" + classToBook["id"]
    const data = { "classId": classToBook["id"], "bookingId": 68862153 + (Math.random()*2000), "bookingStatus": 0 }
    let booked = null

    // Try to book every second for 10 seconds
    for (let i = 0; i < 20; i++) {
        booked = await tryToBook(newBookClassURL, data)
        if (booked) return
        await sleep(500)
    }

    // If didnt work try to book every 20 seconds for 6.6 minutes
    for (let i = 0; i < 20; i++) {
        booked = await tryToBook(newBookClassURL, data)
        if (booked) return
        await sleep(20*1000)
    }
}

async function getClasses() {
    // Get avilable classes
    const r = await axios.get(getClassesURL)
    if (r.status != 200) {
        console.log("Couldn't get classes")
        throw "Couldn't get classes"
    }

    const res = r.data
    const mappedClasses = res['classes'].map((x) => {
        return {
            "class": x["typeId"],
            "location": x["location"][0],
            "starts": new Date(x["starts"]), // Add two hours
            "id": x["id"]
        }
    })
    
    for (let gymClass of mappedClasses.reverse()) {
        if (gymClass["starts"].getTime() < new Date().getTime() + 2 * ONE_DAY) continue

        console.log("Available classes: \n" +
            "Class:  " + gymClass["class"] + "\n" +
            "Location:  " + gymClass["location"] + "\n" +
            "Starts:  " + gymClass["starts"] + "\n" +
            "id:  " + gymClass["id"] + "\n")

    }
    return mappedClasses.reverse()
}

async function testCookie() {
    try {
        const r = await axios.get('https://digitalplatform-prod-svc.azurewebsites.net/v2/Booking/BookedClasses', {headers})
    } catch (err) {
        console.log('bad cookie :(', err.response.status)
        return false
    }
    return true
}

async function tryToBook(url, data) {
    try {
        console.log("Attempted to book at " + new Date())
        const r = await axios.post(url, data, {headers})
    } catch (err) {
        if (err.response.status == 401) {
            console.log("Cookie outdated :(") 
            return true
        } else if (err.response.status == 500) {
            if (err.response.data["errorMessage"] == "ALREADY_ON_WAITING_LIST") {
                console.log("Made it to the waiting list :/ (ALREADY_ON_WAITING_LIST)")
                return true
            }
            else if (err.response.data["errorMessage"] == "ALREADY_BOOKED") {
                console.log("Done! :) (ALREADY_BOOKED)")
                return true
            }
            else if (err.response.data["errorMessage"] == "TOO_LATE_TO_BOOK_WAITING_LIST") {
                console.log("Too late! :( (TOO_LATE_TO_BOOK_WAITING_LIST)")
                return true
            }
        }
    }
}

async function askForClassToBook(mappedClasses) {
    // Get class from user input
    let classToBook = null
    let idToFind
    if (process.argv.length <= 3) idToFind = process.argv[2]

    while (!idToFind) {
        idToFind = await input('Enter the class ID you want to book: ')

        console.log('selected', idToFind)
    }
    for (let c of mappedClasses) {
        if (c["id"] == parseInt(idToFind)) classToBook = c

    }
    console.log("Selected: ", JSON.stringify(classToBook, null, 4))
    return classToBook
}

async function scrapeCookie() {

    browser = await puppeteer.launch({ headless: true })
    page = await browser.newPage()

    // Click log in
    await page.goto('https://se.fitness24seven.com/mina-sidor/oversikt/')
    await page.waitForSelector('.c-login .c-btn')
    await page.click('.c-login .c-btn')
    await page.waitForNavigation({ 'timeout': 10 * 1000, 'waitUntil': "networkidle2" })

    // Type in email
    await page.waitForSelector('[name="Username or email address"]')
    await page.click('[name="Username or email address"]')
    await page.type('[name="Username or email address"]', email)
    await page.waitForSelector('[name="Username or email address"]')
    await page.click('[name="Lösenord"]')
    await page.type('[name="Lösenord"]', password)


    const result = [];
    await page.setRequestInterception(true);
    await page.on('request', request => {
        result.push({ url: request.url(), headers: request.headers()})
        request.continue()
    });
    await page.click('[id="next"]', { waitUntil: 'networkidle0' })
    await page.waitForNavigation({ 'timeout': 10 * 1000, 'waitUntil': "networkidle2" })
    
    
    await page.goto('https://se.fitness24seven.com/mina-sidor/mina-bokningar/', { waitUntil: 'networkidle0'})
    await sleep(5000)

    cookies = await page.cookies()
    const theOne = result.find(req => req.url == "https://digitalplatform-prod-svc.azurewebsites.net/v2/Booking/BookedClasses" && req.headers.authorization)
    await browser.close()
    return theOne.headers.authorization
}

function input(text) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    return new Promise(resolve => rl.question(text, ans => {
        rl.close();
        resolve(ans);
    }))
}
function sleep(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

main().then(res => {
    console.log('Done!', res)
}).catch(err => {
    console.error('FAILED', err)
})