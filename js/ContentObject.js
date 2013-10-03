/**
 * @author: Meki Cheraoui
 * See COPYING for copyright and distribution information.
 * This class represents ContentObject Objects
 */

var DataUtils = require('./encoding/DataUtils.js').DataUtils;
var Name = require('./Name.js').Name;
var BinaryXMLEncoder = require('./encoding/BinaryXMLEncoder.js').BinaryXMLEncoder;
var BinaryXMLDecoder = require('./encoding/BinaryXMLDecoder.js').BinaryXMLDecoder;
var NDNProtocolDTags = require('./util/NDNProtocolDTags.js').NDNProtocolDTags;
var NDNTime = require('./util/NDNTime.js').NDNTime;
var Key = require('./Key.js').Key;
var KeyLocator = require('./Key.js').KeyLocator;
var KeyLocatorType = require('./Key.js').KeyLocatorType;
var PublisherPublicKeyDigest = require('./PublisherPublicKeyDigest.js').PublisherPublicKeyDigest;
var globalKeyManager = require('./security/KeyManager.js').globalKeyManager;
var LOG = require('./Log.js').Log.LOG;

/**
 * Create a new ContentObject with the optional values.
 * 
 * @constructor
 * @param {Name} name
 * @param {SignedInfo} signedInfo
 * @param {Buffer} content
 */
var ContentObject = function ContentObject(name, signedInfo, content) {
	if (typeof name == 'string')
		this.name = new Name(name);
	else
		//TODO Check the class of name
		this.name = name;
	
	this.signedInfo = signedInfo;
	
	if (typeof content == 'string') 
		this.content = DataUtils.toNumbersFromString(content);
	else 
		this.content = content;
	
	this.signature = new Signature();
	
	this.startSIG = null;
	this.endSIG = null;
	
	this.endContent = null;
	
	this.rawSignatureData = null;
};

exports.ContentObject = ContentObject;

ContentObject.prototype.sign = function(){
    var n1 = this.encodeObject(this.name);
    var n2 = this.encodeObject(this.signedInfo);
    var n3 = this.encodeContent();
	
    var rsa = require("crypto").createSign('RSA-SHA256');
    rsa.update(n1);
    rsa.update(n2);
    rsa.update(n3);
    
    var sig = new Buffer(rsa.sign(globalKeyManager.privateKey));

    this.signature.signature = sig;
};

ContentObject.prototype.verify = function (/*Key*/ key) {
    if (key == null || key.publicKeyPem == null) {
	throw new Error('Cannot verify ContentObject without a public key.');
    }

    var verifier = require('crypto').createVerify('RSA-SHA256');
    verifier.update(this.rawSignatureData);
    return verifier.verify(key.publicKeyPem, this.signature.signature);
};


ContentObject.prototype.encodeObject = function encodeObject(obj){
	var enc = new BinaryXMLEncoder();
 
	obj.to_ndnb(enc);
	
	var num = enc.getReducedOstream();

	return num;

	
};

ContentObject.prototype.encodeContent = function encodeContent(obj){
	var enc = new BinaryXMLEncoder();
	 
	enc.writeElement(NDNProtocolDTags.Content, this.content);

	var num = enc.getReducedOstream();

	return num;

	
};

ContentObject.prototype.saveRawData = function(bytes){
	
	var sigBits = bytes.slice(this.startSIG, this.endSIG);

    this.rawSignatureData = new Buffer(sigBits);
};

ContentObject.prototype.getElementLabel= function(){return NDNProtocolDTags.ContentObject;};

/**
 * Create a new Signature with the optional values.
 * @constructor
 */
var Signature = function Signature(witness, signature, digestAlgorithm) {
  this.witness = witness;
	this.signature = signature;
	this.digestAlgorithm = digestAlgorithm
};

exports.Signature = Signature;

Signature.prototype.from_ndnb =function( decoder) {
		decoder.readStartElement(this.getElementLabel());
		
		if(LOG>4)console.log('STARTED DECODING SIGNATURE');
		
		if (decoder.peekStartElement(NDNProtocolDTags.DigestAlgorithm)) {
			if(LOG>4)console.log('DIGIEST ALGORITHM FOUND');
			this.digestAlgorithm = decoder.readUTF8Element(NDNProtocolDTags.DigestAlgorithm); 
		}
		if (decoder.peekStartElement(NDNProtocolDTags.Witness)) {
			if(LOG>4)console.log('WITNESS FOUND');
			this.witness = decoder.readBinaryElement(NDNProtocolDTags.Witness); 
		}
		
		//FORCE TO READ A SIGNATURE

			if(LOG>4)console.log('SIGNATURE FOUND');
			this.signature = decoder.readBinaryElement(NDNProtocolDTags.SignatureBits);

		decoder.readEndElement();

};


Signature.prototype.to_ndnb= function( encoder){
    	
	if (!this.validate()) {
		throw new Error("Cannot encode: field values missing.");
	}
	
	encoder.writeStartElement(this.getElementLabel());
	
	if ((null != this.digestAlgorithm) && (!this.digestAlgorithm.equals(NDNDigestHelper.DEFAULT_DIGEST_ALGORITHM))) {
		encoder.writeElement(NDNProtocolDTags.DigestAlgorithm, OIDLookup.getDigestOID(this.DigestAlgorithm));
	}
	
	if (null != this.witness) {
		// needs to handle null witness
		encoder.writeElement(NDNProtocolDTags.Witness, this.witness);
	}

	encoder.writeElement(NDNProtocolDTags.SignatureBits, this.signature);

	encoder.writeEndElement();   		
};

Signature.prototype.getElementLabel = function() { return NDNProtocolDTags.Signature; };


Signature.prototype.validate = function() {
		return null != this.signature;
};


var ContentType = {DATA:0, ENCR:1, GONE:2, KEY:3, LINK:4, NACK:5};
var ContentTypeValue = {0:0x0C04C0, 1:0x10D091,2:0x18E344,3:0x28463F,4:0x2C834A,5:0x34008A};
var ContentTypeValueReverse = {0x0C04C0:0, 0x10D091:1,0x18E344:2,0x28463F:3,0x2C834A:4,0x34008A:5};

exports.ContentType = ContentType;

/**
 * Create a new SignedInfo with the optional values.
 * @constructor
 */
var SignedInfo = function SignedInfo(publisher, timestamp, type, locator, freshnessSeconds, finalBlockID) {
  this.publisher = publisher; //publisherPublicKeyDigest
  this.timestamp=timestamp; // NDN Time
  this.type=type; // ContentType
  this.locator =locator;//KeyLocator
  this.freshnessSeconds =freshnessSeconds; // Integer
  this.finalBlockID=finalBlockID; //byte array
    
  this.setFields();
};

exports.SignedInfo = SignedInfo;

SignedInfo.prototype.setFields = function(){
	//BASE64 -> RAW STRING
	
	//this.locator = new KeyLocator(  DataUtils.toNumbersFromString(stringCertificate)  ,KeyLocatorType.CERTIFICATE );
/*	
	var publicKeyHex = globalKeyManager.publicKey;

	if(LOG>4)console.log('PUBLIC KEY TO WRITE TO CONTENT OBJECT IS ');
	if(LOG>4)console.log(publicKeyHex);
	
	var publicKeyBytes = DataUtils.toNumbers(globalKeyManager.publicKey) ; 

	

	//var stringCertificate = DataUtils.base64toString(globalKeyManager.certificate);
	
	//if(LOG>3)console.log('string Certificate is '+stringCertificate);

	//HEX -> BYTE ARRAY
	//var publisherkey = DataUtils.toNumbers(hex_sha256(stringCertificate));
	
	//if(LOG>3)console.log('publisher key is ');
	//if(LOG>3)console.log(publisherkey);
	
	var publisherKeyDigest = hex_sha256_from_bytes(publicKeyBytes);

	this.publisher = new PublisherPublicKeyDigest(  DataUtils.toNumbers(  publisherKeyDigest )  );
	
	//this.publisher = new PublisherPublicKeyDigest(publisherkey);
*/
    var key = new Key();
    key.fromPemString(globalKeyManager.publicKey, globalKeyManager.privateKey);
    this.publisher = new PublisherPublicKeyDigest(key.getKeyID());

    var d = new Date();
    
    var time = d.getTime();	

    this.timestamp = new NDNTime( time );
    
    if(LOG>4)console.log('TIME msec is');

    if(LOG>4)console.log(this.timestamp.msec);

    //DATA
	this.type = 0;//0x0C04C0;//ContentTypeValue[ContentType.DATA];
	
	//if(LOG>4)console.log('toNumbersFromString(stringCertificate) '+DataUtils.toNumbersFromString(stringCertificate));
	
	if(LOG>4)console.log('PUBLIC KEY TO WRITE TO CONTENT OBJECT IS ');
	if(LOG>4)console.log(publicKeyBytes);

    this.locator = new KeyLocator(key.publicToDER(), KeyLocatorType.KEY );

	//this.locator = new KeyLocator(  DataUtils.toNumbersFromString(stringCertificate)  ,KeyLocatorType.CERTIFICATE );

};

SignedInfo.prototype.from_ndnb = function( decoder){

		decoder.readStartElement( this.getElementLabel() );
		
		if (decoder.peekStartElement(NDNProtocolDTags.PublisherPublicKeyDigest)) {
			if(LOG>4)console.log('DECODING PUBLISHER KEY');
			this.publisher = new PublisherPublicKeyDigest();
			this.publisher.from_ndnb(decoder);
		}

		if (decoder.peekStartElement(NDNProtocolDTags.Timestamp)) {
			if(LOG>4)console.log('DECODING TIMESTAMP');
			this.timestamp = decoder.readDateTime(NDNProtocolDTags.Timestamp);
		}

		if (decoder.peekStartElement(NDNProtocolDTags.Type)) {
			var binType = decoder.readBinaryElement(NDNProtocolDTags.Type);//byte [] 
		
			
			//TODO Implement type of Key Reading
			
			if(LOG>4)console.log('Binary Type of of Signed Info is '+binType);

			this.type = binType;
			
			
			//TODO Implement type of Key Reading
			
			
			if (null == this.type) {
				throw new Error("Cannot parse signedInfo type: bytes.");
			}
			
		} else {
			this.type = ContentType.DATA; // default
		}
		
		if (decoder.peekStartElement(NDNProtocolDTags.FreshnessSeconds)) {
			this.freshnessSeconds = decoder.readIntegerElement(NDNProtocolDTags.FreshnessSeconds);
			if(LOG>4)console.log('FRESHNESS IN SECONDS IS '+ this.freshnessSeconds);
		}
		
		if (decoder.peekStartElement(NDNProtocolDTags.FinalBlockID)) {
			if(LOG>4)console.log('DECODING FINAL BLOCKID');
			this.finalBlockID = decoder.readBinaryElement(NDNProtocolDTags.FinalBlockID);
		}
		
		if (decoder.peekStartElement(NDNProtocolDTags.KeyLocator)) {
			if(LOG>4)console.log('DECODING KEY LOCATOR');
			this.locator = new KeyLocator();
			this.locator.from_ndnb(decoder);
		}
				
		decoder.readEndElement();
};

SignedInfo.prototype.to_ndnb = function( encoder)  {
		if (!this.validate()) {
			throw new Error("Cannot encode : field values missing.");
		}
		encoder.writeStartElement(this.getElementLabel());
		
		if (null!=this.publisher) {
			if(LOG>3) console.log('ENCODING PUBLISHER KEY' + this.publisher.publisherPublicKeyDigest);

			this.publisher.to_ndnb(encoder);
		}

		if (null!=this.timestamp) {
			encoder.writeDateTime(NDNProtocolDTags.Timestamp, this.timestamp );
		}
		
		if (null!=this.type && this.type !=0) {
			
			encoder.writeElement(NDNProtocolDTags.type, this.type);
		}
		
		if (null!=this.freshnessSeconds) {
			encoder.writeElement(NDNProtocolDTags.FreshnessSeconds, this.freshnessSeconds);
		}

		if (null!=this.finalBlockID) {
			encoder.writeElement(NDNProtocolDTags.FinalBlockID, this.finalBlockID);
		}

		if (null!=this.locator) {
			this.locator.to_ndnb(encoder);
		}

		encoder.writeEndElement();   		
};
	
SignedInfo.prototype.valueToType = function(){
	//for (Entry<byte [], ContentType> entry : ContentValueTypes.entrySet()) {
		//if (Arrays.equals(value, entry.getKey()))
			//return entry.getValue();
		//}
	return null;
	
};

SignedInfo.prototype.getElementLabel = function() { 
	return NDNProtocolDTags.SignedInfo;
};

SignedInfo.prototype.validate = function() {
		// We don't do partial matches any more, even though encoder/decoder
		// is still pretty generous.
		if (null ==this.publisher || null==this.timestamp ||null== this.locator)
			return false;
		return true;
};

// Since BinaryXmlWireFormat.js includes this file, put these at the bottom to avoid problems with cycles of require.
var BinaryXmlWireFormat = require('./encoding/BinaryXmlWireFormat.js').BinaryXmlWireFormat;

/**
 * @deprecated Use BinaryXmlWireFormat.decodeContentObject.
 */
ContentObject.prototype.from_ndnb = function(/*XMLDecoder*/ decoder) {
  BinaryXmlWireFormat.decodeContentObject(this, decoder);
};

/**
 * @deprecated Use BinaryXmlWireFormat.encodeContentObject.
 */
ContentObject.prototype.to_ndnb = function(/*XMLEncoder*/ encoder)  {
  BinaryXmlWireFormat.encodeContentObject(this, encoder);
};

/**
 * Encode this ContentObject for a particular wire format.
 * @param {WireFormat} wireFormat if null, use BinaryXmlWireFormat.
 * @returns {Buffer}
 */
ContentObject.prototype.encode = function(wireFormat) {
  wireFormat = (wireFormat || BinaryXmlWireFormat.instance);
  return wireFormat.encodeContentObject(this);
};

/**
 * Decode the input using a particular wire format and update this ContentObject.
 * @param {Buffer} input
 * @param {WireFormat} wireFormat if null, use BinaryXmlWireFormat.
 */
ContentObject.prototype.decode = function(input, wireFormat) {
  wireFormat = (wireFormat || BinaryXmlWireFormat.instance);
  wireFormat.decodeContentObject(this, input);
};
