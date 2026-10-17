import test from "node:test";
import assert from "node:assert/strict";
import { parseBlocks } from "./markdown.js";
import { parseInput, feedURLFor, parseFeed, stripBoilerplate, parseHTML, textOf, embedTarget, htmlToSections, clipText, fitSections, attributionLine, mediumImageID, resizeURL, serializeSection } from "../../supabase/functions/medium-import/medium.js";

export const FEED_XML = "<?xml version=\"1.0\" encoding=\"UTF-8\"?><rss xmlns:dc=\"http://purl.org/dc/elements/1.1/\" xmlns:content=\"http://purl.org/rss/1.0/modules/content/\" xmlns:atom=\"http://www.w3.org/2005/Atom\" version=\"2.0\" xmlns:cc=\"http://cyber.law.harvard.edu/rss/creativeCommonsRssModule.html\">\n    <channel>\n        <title><![CDATA[Stories by Yasser El-Sayed on Medium]]></title>\n        <description><![CDATA[Stories by Yasser El-Sayed on Medium]]></description>\n        <link>https://medium.com/@theyasser?source=rss-1f7cbb44c998------2</link>\n        <image>\n            <url>https://cdn-images-1.medium.com/fit/c/150/150/1*33rymHeA2zzK9pROqmC4SQ.png</url>\n            <title>Stories by Yasser El-Sayed on Medium</title>\n            <link>https://medium.com/@theyasser?source=rss-1f7cbb44c998------2</link>\n        </image>\n        <generator>Medium</generator>\n        <lastBuildDate>Fri, 16 Oct 2026 18:12:15 GMT</lastBuildDate>\n        <atom:link href=\"https://medium.com/@theyasser/feed\" rel=\"self\" type=\"application/rss+xml\"/>\n        <webMaster><![CDATA[yourfriends@medium.com]]></webMaster>\n        <atom:link href=\"http://medium.superfeedr.com\" rel=\"hub\"/>\n        <item>\n            <title><![CDATA[The Hidden Cost of AI Code Assistants]]></title>\n            <description><![CDATA[<div class=\"medium-feed-item\"><p class=\"medium-feed-image\"><a href=\"https://levelup.gitconnected.com/the-hidden-cost-of-ai-code-assistants-5123886e38bd?source=rss-1f7cbb44c998------2\"><img src=\"https://cdn-images-1.medium.com/max/1536/0*qYHdd-14XMPL5itZ\" width=\"1536\"></a></p><p class=\"medium-feed-snippet\">I began this article with a pretty negative view of AI code assistants like Copilot.</p><p class=\"medium-feed-link\"><a href=\"https://levelup.gitconnected.com/the-hidden-cost-of-ai-code-assistants-5123886e38bd?source=rss-1f7cbb44c998------2\">Continue reading on Level Up Coding »</a></p></div>]]></description>\n            <link>https://levelup.gitconnected.com/the-hidden-cost-of-ai-code-assistants-5123886e38bd?source=rss-1f7cbb44c998------2</link>\n            <guid isPermaLink=\"false\">https://medium.com/p/5123886e38bd</guid>\n            <category><![CDATA[coding]]></category>\n            <category><![CDATA[software-engineering]]></category>\n            <category><![CDATA[software-development]]></category>\n            <category><![CDATA[ai]]></category>\n            <category><![CDATA[artificial-intelligence]]></category>\n            <dc:creator><![CDATA[Yasser El-Sayed]]></dc:creator>\n            <pubDate>Wed, 23 Apr 2025 16:31:38 GMT</pubDate>\n            <atom:updated>2025-04-23T16:31:38.388Z</atom:updated>\n        </item>\n        <item>\n            <title><![CDATA[Visualizing React Memoization]]></title>\n            <link>https://levelup.gitconnected.com/visualizing-react-memoization-d734574ed2e7?source=rss-1f7cbb44c998------2</link>\n            <guid isPermaLink=\"false\">https://medium.com/p/d734574ed2e7</guid>\n            <category><![CDATA[memoization]]></category>\n            <category><![CDATA[javascript]]></category>\n            <category><![CDATA[reactjs]]></category>\n            <category><![CDATA[front-end-development]]></category>\n            <category><![CDATA[react]]></category>\n            <dc:creator><![CDATA[Yasser El-Sayed]]></dc:creator>\n            <pubDate>Thu, 19 Sep 2024 21:02:20 GMT</pubDate>\n            <atom:updated>2024-09-19T21:02:20.400Z</atom:updated>\n            <content:encoded><![CDATA[<p>One of the most useful features in React is <strong>memoization</strong>. We can use memoization to prevent React from re-rendering expensive parts of our react subtree.</p><p>This article will visualize how state changes propagates down the React component tree then apply memo and see how that propagation changes.</p><p>This was a fun experiment so I hope you enjoy and learn something new!</p><blockquote>Note: all the code for this experiment can be found <a href=\"https://github.com/yelsayed/visualize-react-memo\">here</a></blockquote><h3>Default Behavior</h3><p>By default when a parent component’s state changes using setState or a change in props React re-renders all the children of that entire subtree. This is because React cannot be sure that a change in the parent’s state would affect the rendering of the child components. Some components are not “Pure” in that there are some side effects that happen because of change of a parent state. This is the case even if the data change happens for only ONE child component, as I’ll present in the following visualization.</p><p>First of, let’s get our experiment playground set up. We will render a list of 9 components each presenting personal data for one person:</p><figure><img alt=\"\" src=\"https://cdn-images-1.medium.com/max/1024/1*J0Sbi0sScfce1S1c-pv3hw.png\" /><figcaption>Simple list of components to experiment with</figcaption></figure><p>I kept the code pretty simple:</p><pre>import {useState} from &quot;react&quot;;</pre><pre>import &#39;./App.css&#39;;<br>import {NameCard} from &#39;./components/NameCard&#39;;<br>import {generateDataList} from &quot;./utils&quot;;<br></pre><pre>let masterData = generateDataList(9);</pre><pre>// Shows Personal Data<br>export const NameCard = memo(({ id, name, sex, age }) =&gt; {<br>    const cardId = `name-card-${id}`;<br>  <br>    return (<br>      &lt;div className=&quot;name-card&quot; id={cardId}&gt;<br>          &lt;div className=&quot;name-card__title&quot;&gt;<br>              &lt;h2 className=&quot;name-card__title__id&quot;&gt; {id}. &lt;/h2&gt;<br>              &lt;h3 className=&quot;name-card__title__name&quot;&gt; {name} &lt;/h3&gt;<br>          &lt;/div&gt;<br>          &lt;p&gt; Sex: {sex} &lt;/p&gt;<br>          &lt;p&gt; Age: {age} &lt;/p&gt;<br>      &lt;/div&gt;<br>    );<br>});</pre><pre>function App() {<br>    const [data, setData] = useState(masterData);</pre><pre>    return (<br>        &lt;div className=&quot;App&quot;&gt;<br>            &lt;div className=&quot;name-list-container&quot;&gt;<br>                {/* Render each one of the names */}<br>                {data.map(i =&gt;<br>                    &lt;NameCard<br>                      {/* Important Note: we&#39;re using key here... */}<br>                      key={i.id}<br>                      name={i.name}<br>                      id={i.id}<br>                      sex={i.sex}<br>                      age={i.age}<br>                    /&gt;<br>              )}<br>            &lt;/div&gt;<br>        &lt;/div&gt;<br>    );<br>}</pre><pre>export default App;</pre><p>In the code above we have the App component that renders a simplelist of NameCard components.</p><h4>Re-ordering the Components</h4><p>It’s important to first understand the expected behavior. Since we’re using the key prop with a unique ID for each component, if the position of one of those component changes then the NameCard components should NOT be re-rendered. The position of the components in the parent tree should only change, but React knows the components themselves have not changed (since there was no change in the passed props or internal state of each component) i.e. the reconciliation process should not re-render those components but simply re-order them.</p><p>Let’s test that!</p><p>First let’s build a way for us to shuffle the list.</p><pre>// Simple shuffle function, details not important<br>function shuffle(array) {<br>    let currentIndex = array.length - 1, randomIndex;<br>    const newArray = [...array];</pre><pre>    // While there remain elements to shuffle.<br>    while (currentIndex !== 0) {<br>        // Pick a remaining element.<br>        randomIndex = Math.floor(Math.random() * currentIndex);</pre><pre>        // And swap it with the current element.<br>        [newArray[currentIndex], newArray[randomIndex]] = [newArray[randomIndex], newArray[currentIndex]];</pre><pre>        currentIndex--;<br>    }</pre><pre>    return newArray;<br>}</pre><pre>function App() {<br>    const [data, setData] = useState(masterData);</pre><pre>    // We added a handler to the shuffle button `onClick`<br>    const onShuffle = () =&gt; setData((oldData) =&gt; shuffle(oldData));</pre><pre>    return (<br>        &lt;div className=&quot;App&quot;&gt;<br>            {/* New Button added here */}<br>            &lt;button onClick={onShuffle}&gt;<br>                Shuffle Elements<br>            &lt;/button&gt;<br>            &lt;div className=&quot;name-list-container&quot;&gt;<br>                {data.map(i =&gt;<br>                    &lt;NameCard<br>                      key={i.id}<br>                      name={i.name}<br>                      id={i.id}<br>                      sex={i.sex}<br>                      age={i.age}<br>                    /&gt;<br>              )}<br>            &lt;/div&gt;<br>        &lt;/div&gt;<br>    );<br>}</pre><p>Second, let’s modify the NameCard component so that we can tell whether the component has re-rendered. We can do this by adding a simple background fade animation.</p><pre>// Will add a class that has a `keyframe` animation then remove it<br>const addAnimation = (cardId) =&gt; {<br>    // Would have been better to pass in a `ref` but I got lazy lol<br>    const card = document.getElementById(cardId);<br>    if (!card) return;</pre><pre>    card.classList.add(&quot;name-card__fade&quot;);<br>    card.addEventListener(&quot;animationend&quot;, () =&gt; {<br>        card.classList.remove(&quot;name-card__fade&quot;);<br>    });<br>}</pre><pre>const NameCard = ({ id, name, sex, age }) =&gt; {<br>    const cardId = `name-card-${id}`;<br>  <br>    // Every time this component is mounted or updated, the animation will be added.<br>    useEffect(() =&gt; {<br>      addAnimation(cardId);<br>    });<br>  <br>    return (<br>        &lt;div className=&quot;name-card&quot; id={cardId}&gt;<br>            &lt;div className=&quot;name-card__title&quot;&gt;<br>              &lt;h2 className=&quot;name-card__title__id&quot;&gt; {id}. &lt;/h2&gt;<br>              &lt;h3 className=&quot;name-card__title__name&quot;&gt; {name} &lt;/h3&gt;<br>            &lt;/div&gt;<br>            &lt;p&gt; Sex: {sex} &lt;/p&gt;<br>            &lt;p&gt; Age: {age} &lt;/p&gt;<br>        &lt;/div&gt;<br>    );<br>};</pre><p>Let’s try it!</p><figure><img alt=\"\" src=\"https://cdn-images-1.medium.com/max/800/0*mt9P7-A_uiAZv1bo.gif\" /><figcaption>All the components are re-rendering on shuffle</figcaption></figure><p>Good news is that the animation is working. The bad news is that when I click shuffle all the components re-render, despite the fact that we’re using the key prop. You can see that the animation plays on all the components when I click on the “Shuffle” button.</p><p>You might be thinking that the data of the whole array changes since the shuffle assigns a new list, so before we resolve this, it would be interesting to see what would happen if we just change only one element in the array.</p><h4>One Element Change</h4><p>Much like the previous experiment, we’ll add one more button that changes the name of one the persons.</p><pre>import {faker} from &quot;@faker-js/faker&quot;;</pre><pre>function getRandomInt(max) {<br>    return Math.floor(Math.random() * max);<br>}</pre><pre>function App() {<br>    const [data, setData] = useState(masterData);</pre><pre>    const onShuffle = () =&gt; setData((oldData) =&gt; shuffle(oldData));<br>  <br>    // Added a function that will pick a random person and change their name<br>    const onChange = () =&gt; {<br>        const randomIndex = getRandomInt(data.length - 1);<br>        const randomPerson = data[randomIndex];</pre><pre>        // Faker will provide us with a new name at random<br>        randomPerson.name = faker.person.fullName(randomPerson.sex);<br>        setData([...data]);<br>    };</pre><pre>    return (<br>        &lt;div className=&quot;App&quot;&gt;<br>            &lt;button onClick={onShuffle}&gt;<br>                Shuffle Elements<br>            &lt;/button&gt;<br>            &lt;div className=&quot;name-list-container&quot;&gt;<br>                {data.map(i =&gt;<br>                    &lt;NameCard<br>                      key={i.id}<br>                      name={i.name}<br>                      id={i.id}<br>                      sex={i.sex}<br>                      age={i.age}<br>                    /&gt;<br>              )}<br>            &lt;/div&gt;<br>        &lt;/div&gt;<br>    );<br>}</pre><p>Let’s try it!</p><figure><img alt=\"\" src=\"https://cdn-images-1.medium.com/max/800/0*HqlURWf5xsBqdLTL.gif\" /><figcaption>All the components are re-rendering even though only one person’s name is changing</figcaption></figure><p>Again we see the same result. Although we can tell that only one name is changing in the gif above, all the components are re-rendered. Ideally this should not be happening, and it can be costly in production environment where some routes/components are computationally/memory intensive.</p><p>In the next section we will utilize the React memoization in order to resolve this.</p><h3>Memoization</h3><p>React provides a pretty easy way for us to do memoization and prevent the whole parent subtree from re-rendering. All we have to do is wrap our components with a memo function provided by React.</p><pre>import {memo} from &quot;react&quot;;</pre><pre>// Just add the `memo` here, it&#39;s like magic<br>export const NameCard = memo(({ id, name, sex, age }) =&gt; {<br>  // Same old code from before...<br>});</pre><p>Now let’s re-try both experiments from above! We’ll start with the random name change.</p><figure><img alt=\"\" src=\"https://cdn-images-1.medium.com/max/800/0*yDTWldp1j9cFhcBv.gif\" /><figcaption>Only one component is re-rendering at a time.</figcaption></figure><p>Much better! Only the components that need to re-render are doing so. Let’s try the shuffle one more time.</p><figure><img alt=\"\" src=\"https://cdn-images-1.medium.com/max/800/0*EEXFyEMPGd-9lLft.gif\" /><figcaption>No components re-rendering</figcaption></figure><p>Even better! Since the components are being re-ordered on the parent subtree, there is no need for any components to re-render.</p><h4>Child Subtree</h4><p>An interesting experiment would be to try the same thing with the subtree of the child component as well. I added another data point for “Favorite Colors” which will render a list of components called ColorName.</p><figure><img alt=\"\" src=\"https://cdn-images-1.medium.com/max/1024/1*hi41eMihWfW75OHHlEBLkw.png\" /><figcaption>Same as before but with the additional “Favorite Colors”</figcaption></figure><p>I will run the same visualization by adding the same animation to the ColorName as the NameCard component; whenever the data changes we should see it pop out. Here is the code for that:</p><pre>const ColorName = ({ id, name }) =&gt; {<br>    const colorId = `color-id-${id}`;<br>  <br>    // This is the same as the `NameCard` component, we should see it pop out if it re-renders<br>    useEffect(() =&gt; {<br>        addAnimation(colorId);<br>    });<br>  <br>    return (<br>      &lt;span id={colorId} className=&quot;child-name&quot;&gt; {name} &lt;/span&gt;<br>    );<br>}</pre><pre>const NameCard = memo(({ id, name, sex, age, colors }) =&gt; {<br>    const cardId = `name-card-${id}`;<br>  <br>    useEffect(() =&gt; {<br>        addAnimation(cardId);<br>    });<br>  <br>    return (<br>        &lt;div className=&quot;name-card&quot; id={cardId}&gt;<br>            &lt;div className=&quot;name-card__title&quot;&gt;<br>                &lt;h2 className=&quot;name-card__title__id&quot;&gt; {id}. &lt;/h2&gt;<br>                &lt;h3 className=&quot;name-card__title__name&quot;&gt; {name} &lt;/h3&gt;<br>            &lt;/div&gt;<br>            &lt;p&gt; Sex: {sex} &lt;/p&gt;<br>            &lt;p&gt; Age: {age} &lt;/p&gt;<br>            {colors &amp;&amp; (<br>                &lt;p&gt; Favorite Colors: {colors.map(color =&gt;<br>                    &lt;ColorName<br>                        {/* Not the best way to do this but you get the idea */}<br>                        key={`${cardId}${color.id}`}<br>                        id={`${cardId}${color.id}`}<br>                        name={color.name}<br>                    /&gt;)}<br>                &lt;/p&gt;<br>            )}<br>        &lt;/div&gt;<br>    );<br>});</pre><p>Now let’s see what happens.</p><figure><img alt=\"\" src=\"https://cdn-images-1.medium.com/max/800/0*MjK7_75R8i5OiPZ3.gif\" /><figcaption>The color components are also rendering</figcaption></figure><p>Let’s change the component code to use memo and run it again.</p><pre>const ColorName = memo(({ id, name }) =&gt; {<br>    const colorId = `color-id-${id}`;<br>  <br>    // This is the same as the `NameCard` component, we should see it pop out if it re-renders<br>    useEffect(() =&gt; {<br>        addAnimation(colorId);<br>    });<br>  <br>    return (<br>      &lt;span id={colorId} className=&quot;child-name&quot;&gt; {name} &lt;/span&gt;<br>    );<br>})</pre><figure><img alt=\"\" src=\"https://cdn-images-1.medium.com/max/800/0*jLJOua0ew5XZ0g6S.gif\" /><figcaption>The color components are no longer rendering</figcaption></figure><p>As we can see memo can also stop the propagation in the child subtrees as well. This seems obvious in hind sight but still interesting to visualize.</p><h4>Pure Components</h4><p>If you’re familiar with <strong>React Pure Components</strong> you might have found yourself wondering what’s the difference between these memoized components and Pure Components? The answer is nothing: memoized components <em>are</em> Pure Components.</p><p>Pure Components are components that give the same output for the same state and props. Meaning that they only re-render if the props or state changes. Memoization as explained above is simply the functional way of achieving Pure Components.</p><h4>Memoize Everything?</h4><p>The visual representation of this helps us understand that React by default does not memoize components by default. In certain cases this may cause some performance issues especially if your app is frequently updating a global state. React does not know if updating the state of the parent will affect the children because some components can contain side effects. Thus, memoizing everything by default can potentially cause unwanted behavior that’s difficult to debug.</p><p>As the developer, however, you DO know the specifics of your components. I personally do not recommend memoizing all your components as memoization has a memory cost to your application, just like using useMemo or useCallback when not needed can cause performance issues over time. React is pretty efficient and the speed benefits you get from memoization may be marginal. You basically have to ask yourself three questions:</p><ol><li>Is this component “Pure” (i.e. it does not contain any side effects)?</li><li>Is this component frequently updated, or is it’s parent frequently changing its state?</li><li>Is this component computationally/memory intensive?</li></ol><p>If the answer to all these three is yes then I think it’s worthwhile. In the end of the day this is an optimization. You need to apply it as you see fit and not overuse it.</p><p>I hope this visualization was helpful to shed light on how component subtrees are rendered and what you can do to optimize it.</p><p>Thanks for reading!</p><img src=\"https://medium.com/_/stat?event=post.clientViewed&referrerSource=full_rss&postId=d734574ed2e7\" width=\"1\" height=\"1\" alt=\"\"><hr><p><a href=\"https://levelup.gitconnected.com/visualizing-react-memoization-d734574ed2e7\">Visualizing React Memoization</a> was originally published in <a href=\"https://levelup.gitconnected.com\">Level Up Coding</a> on Medium, where people are continuing the conversation by highlighting and responding to this story.</p>]]></content:encoded>\n        </item>\n    </channel>\n</rss>\n";

export const STORY_HTML = "<p>One of the most useful features in React is <strong>memoization</strong>. We can use memoization to prevent React from re-rendering expensive parts of our react subtree.</p><p>This article will visualize how state changes propagates down the React component tree then apply memo and see how that propagation changes.</p><p>This was a fun experiment so I hope you enjoy and learn something new!</p><blockquote>Note: all the code for this experiment can be found <a href=\"https://github.com/yelsayed/visualize-react-memo\">here</a></blockquote><h3>Default Behavior</h3><p>By default when a parent component’s state changes using setState or a change in props React re-renders all the children of that entire subtree. This is because React cannot be sure that a change in the parent’s state would affect the rendering of the child components. Some components are not “Pure” in that there are some side effects that happen because of change of a parent state. This is the case even if the data change happens for only ONE child component, as I’ll present in the following visualization.</p><p>First of, let’s get our experiment playground set up. We will render a list of 9 components each presenting personal data for one person:</p><figure><img alt=\"\" src=\"https://cdn-images-1.medium.com/max/1024/1*J0Sbi0sScfce1S1c-pv3hw.png\" /><figcaption>Simple list of components to experiment with</figcaption></figure><p>I kept the code pretty simple:</p><pre>import {useState} from &quot;react&quot;;</pre><pre>import &#39;./App.css&#39;;<br>import {NameCard} from &#39;./components/NameCard&#39;;<br>import {generateDataList} from &quot;./utils&quot;;<br></pre><pre>let masterData = generateDataList(9);</pre><pre>// Shows Personal Data<br>export const NameCard = memo(({ id, name, sex, age }) =&gt; {<br>    const cardId = `name-card-${id}`;<br>  <br>    return (<br>      &lt;div className=&quot;name-card&quot; id={cardId}&gt;<br>          &lt;div className=&quot;name-card__title&quot;&gt;<br>              &lt;h2 className=&quot;name-card__title__id&quot;&gt; {id}. &lt;/h2&gt;<br>              &lt;h3 className=&quot;name-card__title__name&quot;&gt; {name} &lt;/h3&gt;<br>          &lt;/div&gt;<br>          &lt;p&gt; Sex: {sex} &lt;/p&gt;<br>          &lt;p&gt; Age: {age} &lt;/p&gt;<br>      &lt;/div&gt;<br>    );<br>});</pre><pre>function App() {<br>    const [data, setData] = useState(masterData);</pre><pre>    return (<br>        &lt;div className=&quot;App&quot;&gt;<br>            &lt;div className=&quot;name-list-container&quot;&gt;<br>                {/* Render each one of the names */}<br>                {data.map(i =&gt;<br>                    &lt;NameCard<br>                      {/* Important Note: we&#39;re using key here... */}<br>                      key={i.id}<br>                      name={i.name}<br>                      id={i.id}<br>                      sex={i.sex}<br>                      age={i.age}<br>                    /&gt;<br>              )}<br>            &lt;/div&gt;<br>        &lt;/div&gt;<br>    );<br>}</pre><pre>export default App;</pre><p>In the code above we have the App component that renders a simplelist of NameCard components.</p><h4>Re-ordering the Components</h4><p>It’s important to first understand the expected behavior. Since we’re using the key prop with a unique ID for each component, if the position of one of those component changes then the NameCard components should NOT be re-rendered. The position of the components in the parent tree should only change, but React knows the components themselves have not changed (since there was no change in the passed props or internal state of each component) i.e. the reconciliation process should not re-render those components but simply re-order them.</p><p>Let’s test that!</p><p>First let’s build a way for us to shuffle the list.</p><pre>// Simple shuffle function, details not important<br>function shuffle(array) {<br>    let currentIndex = array.length - 1, randomIndex;<br>    const newArray = [...array];</pre><pre>    // While there remain elements to shuffle.<br>    while (currentIndex !== 0) {<br>        // Pick a remaining element.<br>        randomIndex = Math.floor(Math.random() * currentIndex);</pre><pre>        // And swap it with the current element.<br>        [newArray[currentIndex], newArray[randomIndex]] = [newArray[randomIndex], newArray[currentIndex]];</pre><pre>        currentIndex--;<br>    }</pre><pre>    return newArray;<br>}</pre><pre>function App() {<br>    const [data, setData] = useState(masterData);</pre><pre>    // We added a handler to the shuffle button `onClick`<br>    const onShuffle = () =&gt; setData((oldData) =&gt; shuffle(oldData));</pre><pre>    return (<br>        &lt;div className=&quot;App&quot;&gt;<br>            {/* New Button added here */}<br>            &lt;button onClick={onShuffle}&gt;<br>                Shuffle Elements<br>            &lt;/button&gt;<br>            &lt;div className=&quot;name-list-container&quot;&gt;<br>                {data.map(i =&gt;<br>                    &lt;NameCard<br>                      key={i.id}<br>                      name={i.name}<br>                      id={i.id}<br>                      sex={i.sex}<br>                      age={i.age}<br>                    /&gt;<br>              )}<br>            &lt;/div&gt;<br>        &lt;/div&gt;<br>    );<br>}</pre><p>Second, let’s modify the NameCard component so that we can tell whether the component has re-rendered. We can do this by adding a simple background fade animation.</p><pre>// Will add a class that has a `keyframe` animation then remove it<br>const addAnimation = (cardId) =&gt; {<br>    // Would have been better to pass in a `ref` but I got lazy lol<br>    const card = document.getElementById(cardId);<br>    if (!card) return;</pre><pre>    card.classList.add(&quot;name-card__fade&quot;);<br>    card.addEventListener(&quot;animationend&quot;, () =&gt; {<br>        card.classList.remove(&quot;name-card__fade&quot;);<br>    });<br>}</pre><pre>const NameCard = ({ id, name, sex, age }) =&gt; {<br>    const cardId = `name-card-${id}`;<br>  <br>    // Every time this component is mounted or updated, the animation will be added.<br>    useEffect(() =&gt; {<br>      addAnimation(cardId);<br>    });<br>  <br>    return (<br>        &lt;div className=&quot;name-card&quot; id={cardId}&gt;<br>            &lt;div className=&quot;name-card__title&quot;&gt;<br>              &lt;h2 className=&quot;name-card__title__id&quot;&gt; {id}. &lt;/h2&gt;<br>              &lt;h3 className=&quot;name-card__title__name&quot;&gt; {name} &lt;/h3&gt;<br>            &lt;/div&gt;<br>            &lt;p&gt; Sex: {sex} &lt;/p&gt;<br>            &lt;p&gt; Age: {age} &lt;/p&gt;<br>        &lt;/div&gt;<br>    );<br>};</pre><p>Let’s try it!</p><figure><img alt=\"\" src=\"https://cdn-images-1.medium.com/max/800/0*mt9P7-A_uiAZv1bo.gif\" /><figcaption>All the components are re-rendering on shuffle</figcaption></figure><p>Good news is that the animation is working. The bad news is that when I click shuffle all the components re-render, despite the fact that we’re using the key prop. You can see that the animation plays on all the components when I click on the “Shuffle” button.</p><p>You might be thinking that the data of the whole array changes since the shuffle assigns a new list, so before we resolve this, it would be interesting to see what would happen if we just change only one element in the array.</p><h4>One Element Change</h4><p>Much like the previous experiment, we’ll add one more button that changes the name of one the persons.</p><pre>import {faker} from &quot;@faker-js/faker&quot;;</pre><pre>function getRandomInt(max) {<br>    return Math.floor(Math.random() * max);<br>}</pre><pre>function App() {<br>    const [data, setData] = useState(masterData);</pre><pre>    const onShuffle = () =&gt; setData((oldData) =&gt; shuffle(oldData));<br>  <br>    // Added a function that will pick a random person and change their name<br>    const onChange = () =&gt; {<br>        const randomIndex = getRandomInt(data.length - 1);<br>        const randomPerson = data[randomIndex];</pre><pre>        // Faker will provide us with a new name at random<br>        randomPerson.name = faker.person.fullName(randomPerson.sex);<br>        setData([...data]);<br>    };</pre><pre>    return (<br>        &lt;div className=&quot;App&quot;&gt;<br>            &lt;button onClick={onShuffle}&gt;<br>                Shuffle Elements<br>            &lt;/button&gt;<br>            &lt;div className=&quot;name-list-container&quot;&gt;<br>                {data.map(i =&gt;<br>                    &lt;NameCard<br>                      key={i.id}<br>                      name={i.name}<br>                      id={i.id}<br>                      sex={i.sex}<br>                      age={i.age}<br>                    /&gt;<br>              )}<br>            &lt;/div&gt;<br>        &lt;/div&gt;<br>    );<br>}</pre><p>Let’s try it!</p><figure><img alt=\"\" src=\"https://cdn-images-1.medium.com/max/800/0*HqlURWf5xsBqdLTL.gif\" /><figcaption>All the components are re-rendering even though only one person’s name is changing</figcaption></figure><p>Again we see the same result. Although we can tell that only one name is changing in the gif above, all the components are re-rendered. Ideally this should not be happening, and it can be costly in production environment where some routes/components are computationally/memory intensive.</p><p>In the next section we will utilize the React memoization in order to resolve this.</p><h3>Memoization</h3><p>React provides a pretty easy way for us to do memoization and prevent the whole parent subtree from re-rendering. All we have to do is wrap our components with a memo function provided by React.</p><pre>import {memo} from &quot;react&quot;;</pre><pre>// Just add the `memo` here, it&#39;s like magic<br>export const NameCard = memo(({ id, name, sex, age }) =&gt; {<br>  // Same old code from before...<br>});</pre><p>Now let’s re-try both experiments from above! We’ll start with the random name change.</p><figure><img alt=\"\" src=\"https://cdn-images-1.medium.com/max/800/0*yDTWldp1j9cFhcBv.gif\" /><figcaption>Only one component is re-rendering at a time.</figcaption></figure><p>Much better! Only the components that need to re-render are doing so. Let’s try the shuffle one more time.</p><figure><img alt=\"\" src=\"https://cdn-images-1.medium.com/max/800/0*EEXFyEMPGd-9lLft.gif\" /><figcaption>No components re-rendering</figcaption></figure><p>Even better! Since the components are being re-ordered on the parent subtree, there is no need for any components to re-render.</p><h4>Child Subtree</h4><p>An interesting experiment would be to try the same thing with the subtree of the child component as well. I added another data point for “Favorite Colors” which will render a list of components called ColorName.</p><figure><img alt=\"\" src=\"https://cdn-images-1.medium.com/max/1024/1*hi41eMihWfW75OHHlEBLkw.png\" /><figcaption>Same as before but with the additional “Favorite Colors”</figcaption></figure><p>I will run the same visualization by adding the same animation to the ColorName as the NameCard component; whenever the data changes we should see it pop out. Here is the code for that:</p><pre>const ColorName = ({ id, name }) =&gt; {<br>    const colorId = `color-id-${id}`;<br>  <br>    // This is the same as the `NameCard` component, we should see it pop out if it re-renders<br>    useEffect(() =&gt; {<br>        addAnimation(colorId);<br>    });<br>  <br>    return (<br>      &lt;span id={colorId} className=&quot;child-name&quot;&gt; {name} &lt;/span&gt;<br>    );<br>}</pre><pre>const NameCard = memo(({ id, name, sex, age, colors }) =&gt; {<br>    const cardId = `name-card-${id}`;<br>  <br>    useEffect(() =&gt; {<br>        addAnimation(cardId);<br>    });<br>  <br>    return (<br>        &lt;div className=&quot;name-card&quot; id={cardId}&gt;<br>            &lt;div className=&quot;name-card__title&quot;&gt;<br>                &lt;h2 className=&quot;name-card__title__id&quot;&gt; {id}. &lt;/h2&gt;<br>                &lt;h3 className=&quot;name-card__title__name&quot;&gt; {name} &lt;/h3&gt;<br>            &lt;/div&gt;<br>            &lt;p&gt; Sex: {sex} &lt;/p&gt;<br>            &lt;p&gt; Age: {age} &lt;/p&gt;<br>            {colors &amp;&amp; (<br>                &lt;p&gt; Favorite Colors: {colors.map(color =&gt;<br>                    &lt;ColorName<br>                        {/* Not the best way to do this but you get the idea */}<br>                        key={`${cardId}${color.id}`}<br>                        id={`${cardId}${color.id}`}<br>                        name={color.name}<br>                    /&gt;)}<br>                &lt;/p&gt;<br>            )}<br>        &lt;/div&gt;<br>    );<br>});</pre><p>Now let’s see what happens.</p><figure><img alt=\"\" src=\"https://cdn-images-1.medium.com/max/800/0*MjK7_75R8i5OiPZ3.gif\" /><figcaption>The color components are also rendering</figcaption></figure><p>Let’s change the component code to use memo and run it again.</p><pre>const ColorName = memo(({ id, name }) =&gt; {<br>    const colorId = `color-id-${id}`;<br>  <br>    // This is the same as the `NameCard` component, we should see it pop out if it re-renders<br>    useEffect(() =&gt; {<br>        addAnimation(colorId);<br>    });<br>  <br>    return (<br>      &lt;span id={colorId} className=&quot;child-name&quot;&gt; {name} &lt;/span&gt;<br>    );<br>})</pre><figure><img alt=\"\" src=\"https://cdn-images-1.medium.com/max/800/0*jLJOua0ew5XZ0g6S.gif\" /><figcaption>The color components are no longer rendering</figcaption></figure><p>As we can see memo can also stop the propagation in the child subtrees as well. This seems obvious in hind sight but still interesting to visualize.</p><h4>Pure Components</h4><p>If you’re familiar with <strong>React Pure Components</strong> you might have found yourself wondering what’s the difference between these memoized components and Pure Components? The answer is nothing: memoized components <em>are</em> Pure Components.</p><p>Pure Components are components that give the same output for the same state and props. Meaning that they only re-render if the props or state changes. Memoization as explained above is simply the functional way of achieving Pure Components.</p><h4>Memoize Everything?</h4><p>The visual representation of this helps us understand that React by default does not memoize components by default. In certain cases this may cause some performance issues especially if your app is frequently updating a global state. React does not know if updating the state of the parent will affect the children because some components can contain side effects. Thus, memoizing everything by default can potentially cause unwanted behavior that’s difficult to debug.</p><p>As the developer, however, you DO know the specifics of your components. I personally do not recommend memoizing all your components as memoization has a memory cost to your application, just like using useMemo or useCallback when not needed can cause performance issues over time. React is pretty efficient and the speed benefits you get from memoization may be marginal. You basically have to ask yourself three questions:</p><ol><li>Is this component “Pure” (i.e. it does not contain any side effects)?</li><li>Is this component frequently updated, or is it’s parent frequently changing its state?</li><li>Is this component computationally/memory intensive?</li></ol><p>If the answer to all these three is yes then I think it’s worthwhile. In the end of the day this is an optimization. You need to apply it as you see fit and not overuse it.</p><p>I hope this visualization was helpful to shed light on how component subtrees are rendered and what you can do to optimize it.</p><p>Thanks for reading!</p><img src=\"https://medium.com/_/stat?event=post.clientViewed&referrerSource=full_rss&postId=d734574ed2e7\" width=\"1\" height=\"1\" alt=\"\"><hr><p><a href=\"https://levelup.gitconnected.com/visualizing-react-memoization-d734574ed2e7\">Visualizing React Memoization</a> was originally published in <a href=\"https://levelup.gitconnected.com\">Level Up Coding</a> on Medium, where people are continuing the conversation by highlighting and responding to this story.</p>";

test("an @handle is recognised", () => {
  assert.deepEqual(parseInput("@janedoe"), { kind: "handle", handle: "janedoe" });
});

test("a bare handle is recognised", () => {
  assert.deepEqual(parseInput("  janedoe  "), { kind: "handle", handle: "janedoe" });
});

test("a profile address is recognised", () => {
  assert.deepEqual(parseInput("https://medium.com/@janedoe"), { kind: "handle", handle: "janedoe" });
});

test("a story address yields its handle and its 12-hex id", () => {
  const got = parseInput("https://medium.com/@janedoe/why-i-left-5123886e38bd?source=rss-abc");
  assert.equal(got.kind, "story");
  assert.equal(got.handle, "janedoe");
  assert.equal(got.postId, "5123886e38bd");
});

test("a publication's own domain is recognised", () => {
  const got = parseInput("https://levelup.gitconnected.com/the-hidden-cost-5123886e38bd");
  assert.equal(got.kind, "story");
  assert.equal(got.host, "levelup.gitconnected.com");
  assert.equal(got.postId, "5123886e38bd");
});

test("a subdomain profile is recognised", () => {
  const got = parseInput("https://janedoe.medium.com/why-i-left-5123886e38bd");
  assert.equal(got.handle, "janedoe");
  assert.equal(got.postId, "5123886e38bd");
});

test("a /p/ short link is a story with no feed to derive", () => {
  const got = parseInput("https://medium.com/p/5123886e38bd");
  assert.equal(got.kind, "story");
  assert.equal(got.postId, "5123886e38bd");
  assert.equal(got.handle, undefined);
});

test("junk is refused", () => {
  assert.equal(parseInput("have you seen this article"), null);
  assert.equal(parseInput(""), null);
  assert.equal(parseInput("https://example.com/hello"), null);
});

test("feed addresses follow from the input", () => {
  assert.equal(feedURLFor(parseInput("@janedoe")), "https://medium.com/feed/@janedoe");
  assert.equal(feedURLFor(parseInput("https://medium.com/@janedoe/why-5123886e38bd")), "https://medium.com/feed/@janedoe");
  assert.equal(feedURLFor(parseInput("https://janedoe.medium.com/why-5123886e38bd")), "https://medium.com/feed/@janedoe");
  assert.equal(feedURLFor(parseInput("https://levelup.gitconnected.com/why-5123886e38bd")), "https://levelup.gitconnected.com/feed");
  assert.equal(feedURLFor(parseInput("https://medium.com/level-up-coding/why-5123886e38bd")), "https://medium.com/feed/level-up-coding");
});

test("a feed becomes a story list", () => {
  const { author, stories } = parseFeed(FEED_XML);
  assert.equal(author, "Yasser El-Sayed");             // first <dc:creator> CDATA
  assert.equal(stories.length, 2);
  // stories[0] is the member-only teaser; stories[1] is the full item
  assert.equal(stories[1].title, "Visualizing React Memoization");
  assert.equal(stories[1].id, "d734574ed2e7");         // from <guid>, NOT <link>
  assert.equal(stories[1].importable, true);
  assert.equal(stories[1].publication, "Level Up Coding");   // from the content footer
  assert.equal(stories[1].publishedAt, "2024-09-19T21:02:20.000Z");
  assert.match(stories[1].excerpt, /memoization/);
  assert.ok(!stories[1].url.includes("source=rss"));   // tracking query stripped
});

test("a member-only story is listed but not importable", () => {
  const { stories } = parseFeed(FEED_XML);
  assert.equal(stories[0].id, "5123886e38bd");
  assert.equal(stories[0].importable, false);
  assert.match(stories[0].reason, /member-only/i);
  assert.equal(stories[0].thumbnail, "");
  assert.equal(stories[0].excerpt, "");
  // it has no content footer, so the publication falls back to the <link> host
  assert.equal(stories[0].publication, "levelup.gitconnected.com");
  assert.equal(stories[0].publishedAt, "2025-04-23T16:31:38.000Z");
});

test("the tracking pixel is dropped", () => {
  const html = `<p>Body</p><img src="https://medium.com/_/stat?event=post.clientViewed&postId=x" width="1" height="1" alt="">`;
  assert.equal(stripBoilerplate(html), "<p>Body</p>");
});

test("the 'originally published' footer and its rule are dropped", () => {
  const html = `<p>Body</p><hr><p><a href="https://x/a-1a2b3c4d5e6f">A</a> was originally published in <a href="https://x">P</a> on Medium, where people are continuing the conversation.</p>`;
  assert.equal(stripBoilerplate(html), "<p>Body</p>");
});

test("a real divider in the article is kept", () => {
  assert.equal(stripBoilerplate(`<p>a</p><hr><p>b</p>`), `<p>a</p><hr><p>b</p>`);
});

test("the real story's footer is stripped", () => {
  const out = stripBoilerplate(STORY_HTML);
  assert.ok(!out.includes("originally published in"));
  assert.ok(!out.includes("/_/stat"));
  assert.ok(out.length < STORY_HTML.length);
});

test("entities are decoded", () => {
  assert.equal(textOf(parseHTML(`<p>a &amp; b &#39;c&#39; &lt;d&gt; &quot;e&quot;</p>`)), `a & b 'c' <d> "e"`);
});

test("br becomes a newline", () => {
  assert.equal(textOf(parseHTML(`<p>a<br>b<br></p>`)), "a\nb\n");
});

test("an attribute value containing > does not end the tag", () => {
  const [a] = parseHTML(`<a href="https://x/?q=a>b">t</a>`);
  assert.equal(a.attrs.href, "https://x/?q=a>b");
});

test("void elements do not swallow the rest", () => {
  const nodes = parseHTML(`<p>x</p><img src="https://y/1.png"><hr><p>z</p>`);
  assert.deepEqual(nodes.map((n) => n.tag), ["p", "img", "hr", "p"]);
});


test("a real story's sections round-trip through parseBlocks", () => {
  const sections = htmlToSections(STORY_HTML);
  for (const s of sections) {
    const types = parseBlocks(s.markdown).map((b) => b.type);
    assert.ok(types.length >= 1, `empty section: ${s.id} ${s.label}`);
    assert.ok(types.every((t) => ["p", "h1", "h2", "h3", "h4", "bullet", "number", "quote", "code", "image", "divider", "video"].includes(t)),
      `${s.id} produced ${types.join(",")}`);
  }
});

test("consecutive <pre> siblings merge into one code block", () => {
  const sections = htmlToSections(`<pre>import a from &#39;b&#39;;<br>import c from &#39;d&#39;;<br></pre><pre>let e = 1;</pre>`);
  const [code] = parseBlocks(sections[0].markdown);
  assert.equal(code.type, "code");
  assert.equal(code.code, "import a from 'b';\nimport c from 'd';\nlet e = 1;");
});

test("a figure becomes an image with its caption", () => {
  const sections = htmlToSections(`<figure><img src="https://cdn-images-1.medium.com/max/1024/1*abc.png" alt="alt"><figcaption>A chart</figcaption></figure>`);
  const [img] = parseBlocks(sections[0].markdown);
  assert.equal(img.type, "image");
  assert.equal(img.caption, "A chart");
  assert.equal(img.url, "https://cdn-images-1.medium.com/max/1024/1*abc.png");
});

test("h3 and h4 map to the site's first two heading levels", () => {
  const got = htmlToSections(`<h3>One</h3><h4>Two</h4>`).map((s) => s.markdown);
  assert.deepEqual(got, ["# One", "## Two"]);
});

test("a list is one section, indented by nesting", () => {
  const [s] = htmlToSections(`<ul><li>a</li><li>b<ul><li>c</li></ul></li></ul>`);
  const blocks = parseBlocks(s.markdown);
  assert.deepEqual(blocks.map((b) => [b.type, b.indent, b.text]), [["bullet", 0, "a"], ["bullet", 0, "b"], ["bullet", 1, "c"]]);
});

test("a medium media embed is dropped and reported, never linked", () => {
  const { sections, dropped } = htmlToSections(`<p>a</p><iframe src="" width="0" height="0"><a href="https://medium.com/media/abc123/href">https://medium.com/media/abc123/href</a></iframe><p>b</p>`, { dropped: true });
  assert.equal(dropped.length, 1);
  assert.equal(dropped[0].kind, "embed");
  assert.ok(!JSON.stringify(sections).includes("medium.com/media"));
});

test("a youtube link becomes a video block", () => {
  const [s] = htmlToSections(`<p>See <a href="https://www.youtube.com/watch?v=dQw4w9WgXcQ">this</a>.</p>`);
  assert.ok(s.markdown.includes("@[video](https://www.youtube.com/watch?v=dQw4w9WgXcQ)"));
});

test("a youtube Embedly frame becomes a video block, not a loss", () => {
  const html = `<iframe src="https://cdn.embedly.com/widgets/media.html?src=https%3A%2F%2Fwww.youtube.com%2Fembed%2Fdpw9EHDh2bM%3Ffeature%3Doembed&amp;display_name=YouTube&amp;url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3Ddpw9EHDh2bM&amp;key=k&amp;type=text%2Fhtml&amp;schema=youtube" width="854" height="480" frameborder="0" scrolling="no"></iframe>`;
  const { sections, dropped } = htmlToSections(html, { dropped: true });
  assert.ok(sections[0].markdown.includes("@[video](https://www.youtube.com/watch?v=dpw9EHDh2bM)"));
  assert.equal(dropped.length, 0);
});

test("a non-youtube Embedly frame keeps its recovered link and never leaks the frame", () => {
  const html = `<iframe src="https://cdn.embedly.com/widgets/media.html?type=text%2Fhtml&amp;key=k&amp;schema=twitter&amp;url=https%3A//twitter.com/u/status/1056594421079261185&amp;image=i" width="500" height="281"></iframe>`;
  const [s] = htmlToSections(html);
  assert.ok(s.markdown.includes("https://twitter.com/u/status/1056594421079261185"));
  assert.ok(!s.markdown.includes("embedly.com"));
});

test("an empty frame with no recoverable target is still a reported loss", () => {
  const html = `<iframe src="" width="0" height="0"><a href="https://medium.com/media/deadbeef/href">https://medium.com/media/deadbeef/href</a></iframe>`;
  const { sections, dropped } = htmlToSections(html, { dropped: true });
  assert.equal(dropped.length, 1);
  assert.equal(dropped[0].kind, "embed");
  assert.ok(!JSON.stringify(sections).includes("medium.com/media"));
});

test("text is clipped by code points, not UTF-16 units", () => {
  assert.equal(clipText("😀😀😀", 2), "😀😀");
  assert.equal([...clipText("😀😀😀", 2)].length, 2);
});

test("clipping adds an ellipsis only when it cuts", () => {
  assert.equal(clipText("hello", 10), "hello");
  assert.equal(clipText("hello there", 5), "hello…");
});

test("sections are kept whole or dropped from the end", () => {
  const sections = [{ markdown: "a".repeat(6) }, { markdown: "b".repeat(6) }, { markdown: "c".repeat(6) }];
  const { sections: kept, dropped } = fitSections(sections, { maxBody: 15 });
  assert.equal(kept.length, 2);      // 6 + 2 + 6 = 14, the third would make 22
  assert.equal(dropped.length, 1);
});

test("the attribution line links the original", () => {
  assert.equal(attributionLine({ url: "https://medium.com/@a/x-1a2b3c4d5e6f" }),
    "Originally published on [Medium](https://medium.com/@a/x-1a2b3c4d5e6f)");
});

test("a Medium image's asset id survives both address shapes", () => {
  assert.equal(mediumImageID("https://cdn-images-1.medium.com/max/1024/1*abc.png"), "1*abc.png");
  assert.equal(mediumImageID("https://cdn-images-1.medium.com/v2/resize:fit:1024/1*abc.png"), "1*abc.png");
  assert.equal(mediumImageID("https://miro.medium.com/v2/resize:fit:1400/1*abc.png"), "1*abc.png");
  assert.equal(mediumImageID("https://miro.medium.com/v2/1*abc.png"), "1*abc.png");
  assert.equal(mediumImageID("https://cdn-images-1.medium.com/1*abc.png"), "1*abc.png");
  assert.equal(mediumImageID("https://example.com/a.png"), null);
});

test("resizeURL points to miro at the requested width", () => {
  assert.equal(resizeURL("1*abc.png"), "https://miro.medium.com/v2/resize:fit:1400/1*abc.png");
  assert.equal(resizeURL("1*abc.png", 800), "https://miro.medium.com/v2/resize:fit:800/1*abc.png");
});

test("a section label is plain text, not markdown", () => {
  const sections = htmlToSections('<p>Here is <strong>bold</strong> and <em>italic</em> and `code` and <a href="https://x">a link</a>.</p>');
  assert.equal(sections[0].label, "Here is bold and italic and code and a link.");
});

test("text around an inline video does not become a stray paragraph", () => {
  const [s] = htmlToSections('<p>Watch this: <a href="https://www.youtube.com/watch?v=dQw4w9WgXcQ">video</a>. Pretty cool.</p>');
  assert.ok(s.markdown.includes("@[video](https://www.youtube.com/watch?v=dQw4w9WgXcQ)"));
  assert.ok(!s.markdown.includes("\n\n.\n\n") && !s.markdown.endsWith("\n\n.") && !s.markdown.includes("\n\n."));
});

test("a gist script contributes nothing, not even its URL", () => {
  const sections = htmlToSections('<script src="https://gist.github.com/abc/123.js"></script>');
  assert.equal(sections.length, 0);
  const sectionsWithFig = htmlToSections('<figure><script src="https://gist.github.com/abc/123.js"></script></figure>');
  assert.equal(sectionsWithFig.length, 0);
});

test("a section can carry its block model so an image address can be rewritten", () => {
  const html = '<figure><img src="https://miro.medium.com/max/800/1*a.png"><figcaption>Cap</figcaption></figure>';
  const [s] = htmlToSections(html, { blocks: true });
  assert.equal(s.blocks[0].type, "image");
  assert.equal(s.blocks[0].url, "https://miro.medium.com/max/800/1*a.png");
  s.blocks[0].url = "https://cdn.jsdelivr.net/gh/TheFreeCodeSyndicate/fcs-assets@abc/blog/2026/10/x.png";
  assert.ok(serializeSection(s.blocks).includes("cdn.jsdelivr.net/gh/TheFreeCodeSyndicate/fcs-assets@abc"));
  assert.ok(!serializeSection(s.blocks).includes("miro.medium.com"));
});

test("a label keeps underscores inside identifiers", () => {
  const [s] = htmlToSections("<p>call set_loading_state(x) then read a_b_c</p>");
  assert.equal(s.label, "call set_loading_state(x) then read a_b_c");
});
